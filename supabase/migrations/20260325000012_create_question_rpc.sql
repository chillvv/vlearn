CREATE OR REPLACE FUNCTION public.create_question(
  p_subject TEXT,
  p_question_text TEXT,
  p_category TEXT DEFAULT NULL,
  p_node TEXT DEFAULT NULL,
  p_image_url TEXT DEFAULT NULL,
  p_knowledge_point TEXT DEFAULT NULL,
  p_ability TEXT DEFAULT NULL,
  p_error_type TEXT DEFAULT NULL,
  p_question_type TEXT DEFAULT NULL,
  p_correct_answer TEXT DEFAULT NULL,
  p_raw_ai_response TEXT DEFAULT NULL,
  p_normalized_payload JSONB DEFAULT NULL,
  p_payload_version TEXT DEFAULT NULL,
  p_validation_status TEXT DEFAULT NULL,
  p_render_mode TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL,
  p_summary TEXT DEFAULT NULL,
  p_confidence INTEGER DEFAULT NULL,
  p_mastery_level INTEGER DEFAULT NULL,
  p_next_review_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  p_stubborn_flag BOOLEAN DEFAULT FALSE,
  p_review_count INTEGER DEFAULT 0
)
RETURNS SETOF questions
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_inserted questions%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  INSERT INTO questions (
    user_id, subject, question_text, category, node, image_url,
    knowledge_point, ability, error_type, question_type, correct_answer,
    raw_ai_response, normalized_payload, payload_version, validation_status,
    render_mode, note, summary, confidence, mastery_level,
    next_review_date, stubborn_flag, review_count
  ) VALUES (
    v_user, p_subject, p_question_text, p_category, p_node, p_image_url,
    p_knowledge_point, p_ability, p_error_type, p_question_type, p_correct_answer,
    p_raw_ai_response, p_normalized_payload, p_payload_version, p_validation_status,
    p_render_mode, p_note, p_summary, p_confidence, p_mastery_level,
    p_next_review_date, p_stubborn_flag, p_review_count
  ) RETURNING * INTO v_inserted;

  IF p_knowledge_point IS NOT NULL AND p_ability IS NOT NULL THEN
    PERFORM increment_user_weakness(p_knowledge_point, p_ability);
  END IF;

  RETURN NEXT v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_question(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, TIMESTAMP WITH TIME ZONE, BOOLEAN, INTEGER
) TO authenticated;
