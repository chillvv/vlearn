-- Create AI diagnosis telemetry table
CREATE TABLE IF NOT EXISTS ai_diagnosis_telemetry (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  question_id UUID REFERENCES questions(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'fallback', 'error', 'timeout')),
  latency_ms INTEGER NOT NULL,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE ai_diagnosis_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own telemetry"
  ON ai_diagnosis_telemetry
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ai_diagnosis_telemetry_user_created
  ON ai_diagnosis_telemetry(user_id, created_at DESC);

-- RPC for global error stats
CREATE OR REPLACE FUNCTION public.get_global_error_stats(p_days INTEGER DEFAULT 7)
RETURNS TABLE (
  date_label TEXT,
  error_pattern TEXT,
  count INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  RETURN QUERY
  SELECT 
    to_char(created_at AT TIME ZONE 'UTC', 'MM-DD') as date_label,
    (ai_diagnosis->>'error_pattern')::TEXT as error_pattern,
    COUNT(*)::INTEGER as count
  FROM question_review_attempts
  WHERE user_id = v_user
    AND is_correct = false
    AND created_at >= NOW() - (p_days || ' days')::INTERVAL
    AND ai_diagnosis->>'error_pattern' IS NOT NULL
  GROUP BY to_char(created_at AT TIME ZONE 'UTC', 'MM-DD'), (ai_diagnosis->>'error_pattern')::TEXT
  ORDER BY to_char(created_at AT TIME ZONE 'UTC', 'MM-DD') ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_global_error_stats(INTEGER) TO authenticated;

-- RPC for triggering plan cache rebuild asynchronously (from client)
CREATE OR REPLACE FUNCTION public.trigger_plan_cache_rebuild(p_days INTEGER DEFAULT 14)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  PERFORM rebuild_review_plan_cache(p_days);
END;
$$;

GRANT EXECUTE ON FUNCTION public.trigger_plan_cache_rebuild(INTEGER) TO authenticated;

-- Update submit_review_attempt to remove synchronous rebuild
CREATE OR REPLACE FUNCTION public.submit_review_attempt(
  p_question_id UUID,
  p_user_answer TEXT,
  p_is_correct BOOLEAN,
  p_rating TEXT,
  p_correct_answer TEXT DEFAULT NULL,
  p_selected_option_text TEXT DEFAULT NULL,
  p_ai_diagnosis JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  attempt_id UUID,
  question_id UUID,
  next_review_date TIMESTAMP WITH TIME ZONE,
  mastery_level INTEGER,
  review_count INTEGER,
  stubborn_flag BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_question questions%ROWTYPE;
  v_confidence NUMERIC;
  v_days INTEGER;
  v_new_confidence NUMERIC;
  v_new_mastery INTEGER;
  v_new_review_count INTEGER;
  v_stubborn BOOLEAN;
  v_next_review TIMESTAMP WITH TIME ZONE;
  v_attempt_id UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  IF p_rating NOT IN ('forgot', 'vague', 'mastered') THEN
    RAISE EXCEPTION 'INVALID_RATING';
  END IF;

  SELECT *
    INTO v_question
  FROM questions
  WHERE id = p_question_id
    AND user_id = v_user
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUESTION_NOT_FOUND';
  END IF;

  v_confidence := COALESCE(v_question.confidence, 0.5);

  IF p_is_correct THEN
    IF p_rating = 'forgot' THEN
      v_new_confidence := GREATEST(0, v_confidence - 0.05);
      v_days := 1;
    ELSIF p_rating = 'vague' THEN
      v_new_confidence := LEAST(1, v_confidence + 0.04);
      v_days := 2;
    ELSE
      v_new_confidence := LEAST(1, v_confidence + 0.12);
      v_days := 4;
    END IF;
  ELSE
    IF p_rating = 'forgot' THEN
      v_new_confidence := GREATEST(0, v_confidence - 0.18);
      v_days := 1;
    ELSIF p_rating = 'vague' THEN
      v_new_confidence := GREATEST(0, v_confidence - 0.08);
      v_days := 1;
    ELSE
      v_new_confidence := GREATEST(0, v_confidence - 0.03);
      v_days := 2;
    END IF;
  END IF;

  v_new_mastery := ROUND(v_new_confidence * 100);
  v_new_review_count := COALESCE(v_question.review_count, 0) + 1;
  
  -- Refined stubborn logic
  DECLARE
    v_recent_attempts RECORD;
    v_wrong_streak INTEGER := 0;
    v_recent_total INTEGER := 0;
    v_recent_correct INTEGER := 0;
    v_recent_accuracy NUMERIC := 0;
  BEGIN
    FOR v_recent_attempts IN 
      SELECT is_correct 
      FROM question_review_attempts 
      WHERE question_id = v_question.id AND user_id = v_user 
      ORDER BY created_at DESC 
      LIMIT 10
    LOOP
      v_recent_total := v_recent_total + 1;
      IF v_recent_attempts.is_correct THEN
        v_recent_correct := v_recent_correct + 1;
      END IF;
    END LOOP;

    v_recent_total := LEAST(10, v_recent_total + 1);
    IF p_is_correct THEN
      v_recent_correct := LEAST(10, v_recent_correct + 1);
      v_wrong_streak := 0;
    ELSE
      v_wrong_streak := 1;
      FOR v_recent_attempts IN 
        SELECT is_correct 
        FROM question_review_attempts 
        WHERE question_id = v_question.id AND user_id = v_user 
        ORDER BY created_at DESC 
        LIMIT 10
      LOOP
        IF v_recent_attempts.is_correct THEN
          EXIT;
        ELSE
          v_wrong_streak := v_wrong_streak + 1;
        END IF;
      END LOOP;
    END IF;

    v_recent_accuracy := v_recent_correct::NUMERIC / NULLIF(v_recent_total, 0);

    v_stubborn := COALESCE(v_question.stubborn_flag, FALSE) 
                  OR (v_wrong_streak >= 3) 
                  OR (v_new_review_count >= 6 AND v_recent_accuracy <= 0.35);
                  
    p_ai_diagnosis := jsonb_set(
      p_ai_diagnosis, 
      '{engine}', 
      jsonb_build_object(
        'wrong_streak', v_wrong_streak,
        'recent_accuracy', ROUND(v_recent_accuracy * 100, 1),
        'stubborn_flag', v_stubborn
      )
    );
  END;

  v_next_review := NOW() + make_interval(days => v_days);

  UPDATE questions
  SET
    confidence = v_new_confidence,
    mastery_level = v_new_mastery,
    next_review_date = v_next_review,
    review_count = v_new_review_count,
    stubborn_flag = v_stubborn
  WHERE id = v_question.id;

  INSERT INTO question_review_attempts(
    user_id,
    question_id,
    question_type,
    user_answer,
    selected_option_text,
    correct_answer,
    is_correct,
    rating,
    error_type,
    ai_diagnosis,
    next_review_date
  )
  VALUES (
    v_user,
    v_question.id,
    v_question.question_type,
    p_user_answer,
    p_selected_option_text,
    p_correct_answer,
    p_is_correct,
    p_rating,
    COALESCE(NULLIF(v_question.error_type, ''), NULLIF(v_question.knowledge_point, ''), '未分类'),
    COALESCE(p_ai_diagnosis, '{}'::jsonb),
    v_next_review
  )
  RETURNING id INTO v_attempt_id;

  -- Removed synchronous rebuild
  -- PERFORM rebuild_review_plan_cache(14);

  RETURN QUERY
  SELECT
    v_attempt_id,
    v_question.id,
    v_next_review,
    v_new_mastery,
    v_new_review_count,
    v_stubborn;
END;
$$;
