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
  v_recent_wrong_streak INTEGER := 0;
  v_recent_correct_count INTEGER := 0;
  v_recent_total INTEGER := 0;
  v_recent_accuracy INTEGER := 0;
  v_stubborn_streak_threshold INTEGER := 3;
  v_stubborn_review_threshold INTEGER := 6;
  v_stubborn_accuracy_threshold INTEGER := 35;
  v_ai_diagnosis JSONB := '{}'::jsonb;
  v_recent_row RECORD;
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

  IF NOT p_is_correct THEN
    v_recent_wrong_streak := 1;
    FOR v_recent_row IN
      SELECT is_correct
      FROM question_review_attempts
      WHERE user_id = v_user
        AND question_id = v_question.id
      ORDER BY created_at DESC
      LIMIT 10
    LOOP
      EXIT WHEN v_recent_row.is_correct;
      v_recent_wrong_streak := v_recent_wrong_streak + 1;
    END LOOP;
  END IF;

  SELECT COUNT(*)
    INTO v_recent_correct_count
  FROM (
    SELECT is_correct
    FROM question_review_attempts
    WHERE user_id = v_user
      AND question_id = v_question.id
    ORDER BY created_at DESC
    LIMIT 9
  ) AS t
  WHERE t.is_correct = TRUE;

  IF p_is_correct THEN
    v_recent_correct_count := v_recent_correct_count + 1;
  END IF;
  v_recent_total := LEAST(v_new_review_count, 10);
  IF v_recent_total > 0 THEN
    v_recent_accuracy := ROUND((v_recent_correct_count::NUMERIC / v_recent_total::NUMERIC) * 100);
  END IF;

  v_stubborn := COALESCE(v_question.stubborn_flag, FALSE)
    OR (NOT p_is_correct AND v_recent_wrong_streak >= v_stubborn_streak_threshold)
    OR (v_new_review_count >= v_stubborn_review_threshold AND v_recent_accuracy <= v_stubborn_accuracy_threshold);

  v_next_review := NOW() + make_interval(days => v_days);

  UPDATE questions
  SET
    confidence = v_new_confidence,
    mastery_level = v_new_mastery,
    next_review_date = v_next_review,
    review_count = v_new_review_count,
    stubborn_flag = v_stubborn
  WHERE id = v_question.id;

  v_ai_diagnosis := COALESCE(p_ai_diagnosis, '{}'::jsonb) || jsonb_build_object(
    'engine',
    jsonb_build_object(
      'wrong_streak', v_recent_wrong_streak,
      'recent_accuracy', v_recent_accuracy,
      'stubborn_flag', v_stubborn
    )
  );

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
    v_ai_diagnosis,
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
