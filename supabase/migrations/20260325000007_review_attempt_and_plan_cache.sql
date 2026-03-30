CREATE TABLE IF NOT EXISTS question_review_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  question_id UUID REFERENCES questions(id) ON DELETE CASCADE NOT NULL,
  question_type TEXT,
  user_answer TEXT,
  selected_option_text TEXT,
  correct_answer TEXT,
  is_correct BOOLEAN NOT NULL DEFAULT FALSE,
  rating TEXT NOT NULL,
  error_type TEXT,
  ai_diagnosis JSONB NOT NULL DEFAULT '{}'::jsonb,
  next_review_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT question_review_attempts_rating_check CHECK (rating IN ('forgot', 'vague', 'mastered'))
);

ALTER TABLE question_review_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own question review attempts"
  ON question_review_attempts
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_question_review_attempts_user_created
  ON question_review_attempts(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_question_review_attempts_question_created
  ON question_review_attempts(question_id, created_at DESC);

CREATE TABLE IF NOT EXISTS review_plan_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  plan_date DATE NOT NULL,
  question_ids UUID[] NOT NULL DEFAULT '{}',
  planned_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, plan_date)
);

ALTER TABLE review_plan_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own review plan cache"
  ON review_plan_cache
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_review_plan_cache_user_date
  ON review_plan_cache(user_id, plan_date);

CREATE OR REPLACE FUNCTION public.rebuild_review_plan_cache(p_days INTEGER DEFAULT 14)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  DELETE FROM review_plan_cache
  WHERE user_id = v_user
    AND plan_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + GREATEST(p_days, 1));

  INSERT INTO review_plan_cache(user_id, plan_date, question_ids, planned_count, metadata, updated_at)
  SELECT
    v_user,
    DATE(COALESCE(q.next_review_date, NOW())),
    ARRAY_AGG(q.id ORDER BY q.next_review_date NULLS FIRST, q.created_at DESC),
    COUNT(*),
    jsonb_build_object(
      'source', 'questions_snapshot',
      'rebuild_at', NOW()
    ),
    NOW()
  FROM questions q
  WHERE q.user_id = v_user
    AND DATE(COALESCE(q.next_review_date, NOW())) BETWEEN CURRENT_DATE AND (CURRENT_DATE + GREATEST(p_days, 1))
  GROUP BY DATE(COALESCE(q.next_review_date, NOW()))
  ON CONFLICT (user_id, plan_date) DO UPDATE SET
    question_ids = EXCLUDED.question_ids,
    planned_count = EXCLUDED.planned_count,
    metadata = EXCLUDED.metadata,
    updated_at = NOW();
END;
$$;

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
  v_stubborn := COALESCE(v_question.stubborn_flag, FALSE) OR (NOT p_is_correct AND v_new_review_count >= 5);
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

  PERFORM rebuild_review_plan_cache(14);

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

GRANT EXECUTE ON FUNCTION public.submit_review_attempt(UUID, TEXT, BOOLEAN, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_review_plan_cache(INTEGER) TO authenticated;
