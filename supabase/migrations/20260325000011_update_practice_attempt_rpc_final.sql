CREATE OR REPLACE FUNCTION public.submit_practice_attempt(
  p_session_id UUID,
  p_question_index INTEGER,
  p_question_text TEXT,
  p_question_type TEXT,
  p_correct_answer TEXT,
  p_user_answer TEXT,
  p_acceptable_answers TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_subject TEXT DEFAULT NULL,
  p_knowledge_point TEXT DEFAULT NULL,
  p_ability TEXT DEFAULT NULL,
  p_error_type TEXT DEFAULT NULL,
  p_duration_seconds INTEGER DEFAULT 0,
  p_source_node TEXT DEFAULT NULL,
  p_ai_prompt_version TEXT DEFAULT NULL,
  p_is_final BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  attempt_id UUID,
  is_correct BOOLEAN,
  canonical_subject TEXT,
  canonical_knowledge_point TEXT,
  canonical_ability TEXT,
  canonical_error_type TEXT,
  wrong_saved BOOLEAN
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_session practice_sessions%ROWTYPE;
  v_tags RECORD;
  v_is_correct BOOLEAN := FALSE;
  v_attempt_id UUID;
  v_exists UUID;
  v_question_type TEXT := lower(btrim(COALESCE(p_question_type, '')));
  v_user_answer_choice TEXT := upper(btrim(COALESCE(p_user_answer, '')));
  v_correct_answer_choice TEXT := upper(btrim(COALESCE(p_correct_answer, '')));
  v_user_answer_norm TEXT := lower(regexp_replace(btrim(COALESCE(p_user_answer, '')), '\s+', ' ', 'g'));
  v_correct_answer_norm TEXT := lower(regexp_replace(btrim(COALESCE(p_correct_answer, '')), '\s+', ' ', 'g'));
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT *
    INTO v_session
  FROM practice_sessions
  WHERE id = p_session_id
    AND user_id = v_user
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRACTICE_SESSION_NOT_FOUND';
  END IF;

  SELECT *
    INTO v_tags
  FROM submit_question_tags(
    p_subject,
    p_knowledge_point,
    p_ability,
    p_error_type
  )
  LIMIT 1;

  IF v_question_type = 'choice' THEN
    v_is_correct := v_user_answer_choice <> '' AND v_user_answer_choice = v_correct_answer_choice;
  ELSE
    v_is_correct := v_user_answer_norm <> '' AND (
      v_user_answer_norm = v_correct_answer_norm
      OR EXISTS (
        SELECT 1
        FROM unnest(COALESCE(p_acceptable_answers, ARRAY[]::TEXT[])) AS candidate(answer_text)
        WHERE lower(regexp_replace(btrim(COALESCE(candidate.answer_text, '')), '\s+', ' ', 'g')) = v_user_answer_norm
      )
    );
  END IF;

  INSERT INTO practice_attempts(
    user_id,
    session_id,
    question_index,
    question_text,
    question_type,
    correct_answer,
    user_answer,
    is_correct,
    knowledge_point,
    duration_seconds,
    source_node,
    ai_prompt_version,
    response_time_ms
  )
  VALUES (
    v_user,
    p_session_id,
    p_question_index,
    p_question_text,
    p_question_type,
    p_correct_answer,
    p_user_answer,
    v_is_correct,
    v_tags.knowledge_point,
    GREATEST(COALESCE(p_duration_seconds, 0), 0),
    p_source_node,
    p_ai_prompt_version,
    GREATEST(COALESCE(p_duration_seconds, 0), 0) * 1000
  )
  RETURNING id INTO v_attempt_id;

  IF v_is_correct THEN
    UPDATE practice_sessions
    SET
      correct_count = COALESCE(correct_count, 0) + 1,
      total_elapsed_seconds = COALESCE(total_elapsed_seconds, 0) + GREATEST(COALESCE(p_duration_seconds, 0), 0),
      status = CASE WHEN p_is_final THEN 'completed' ELSE status END,
      completed_at = CASE WHEN p_is_final THEN NOW() ELSE completed_at END
    WHERE id = p_session_id;
  ELSE
    UPDATE practice_sessions
    SET
      wrong_count = COALESCE(wrong_count, 0) + 1,
      total_elapsed_seconds = COALESCE(total_elapsed_seconds, 0) + GREATEST(COALESCE(p_duration_seconds, 0), 0),
      status = CASE WHEN p_is_final THEN 'completed' ELSE status END,
      completed_at = CASE WHEN p_is_final THEN NOW() ELSE completed_at END
    WHERE id = p_session_id;

    SELECT id
      INTO v_exists
    FROM questions
    WHERE user_id = v_user
      AND subject = v_tags.subject
      AND knowledge_point = v_tags.knowledge_point
      AND question_text = p_question_text
    LIMIT 1;

    IF v_exists IS NULL THEN
      INSERT INTO questions(
        user_id,
        subject,
        question_text,
        knowledge_point,
        ability,
        error_type,
        note,
        review_count
      )
      VALUES (
        v_user,
        v_tags.subject,
        p_question_text,
        v_tags.knowledge_point,
        v_tags.ability,
        v_tags.error_type,
        '专项练习服务端自动回流',
        0
      );
      PERFORM increment_user_weakness(v_tags.knowledge_point, v_tags.ability);
      wrong_saved := TRUE;
    ELSE
      wrong_saved := FALSE;
    END IF;
  END IF;

  attempt_id := v_attempt_id;
  is_correct := v_is_correct;
  canonical_subject := v_tags.subject;
  canonical_knowledge_point := v_tags.knowledge_point;
  canonical_ability := v_tags.ability;
  canonical_error_type := v_tags.error_type;
  IF v_is_correct THEN
    wrong_saved := FALSE;
  END IF;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_practice_attempt(
  UUID, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, BOOLEAN
) TO authenticated;
