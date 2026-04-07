ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS priority_score NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS plan_source TEXT;

ALTER TABLE public.questions
  ALTER COLUMN plan_source SET DEFAULT 'rule_fallback';

ALTER TABLE public.questions
  DROP CONSTRAINT IF EXISTS questions_plan_source_check;

ALTER TABLE public.questions
  ADD CONSTRAINT questions_plan_source_check
  CHECK (plan_source IN ('ai', 'rule_fallback'));

CREATE OR REPLACE FUNCTION public.compute_review_priority_score(
  p_next_review_date TIMESTAMP WITH TIME ZONE,
  p_confidence NUMERIC DEFAULT NULL,
  p_stubborn_flag BOOLEAN DEFAULT FALSE,
  p_review_count INTEGER DEFAULT 0,
  p_mastery_state TEXT DEFAULT 'active',
  p_is_archived BOOLEAN DEFAULT FALSE
)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_due_component NUMERIC := 0;
  v_overdue_days NUMERIC := 0;
  v_days_until_due NUMERIC := 0;
  v_confidence_component NUMERIC := 0;
  v_stubborn_component NUMERIC := 0;
  v_review_component NUMERIC := 0;
  v_state_component NUMERIC := 0;
  v_score NUMERIC := 0;
BEGIN
  IF COALESCE(p_is_archived, FALSE) OR COALESCE(p_mastery_state, 'active') = 'archived' THEN
    RETURN 0;
  END IF;

  IF p_next_review_date IS NULL THEN
    v_due_component := 35;
  ELSIF p_next_review_date <= NOW() THEN
    v_overdue_days := GREATEST(0, EXTRACT(EPOCH FROM (NOW() - p_next_review_date)) / 86400.0);
    v_due_component := 60 + LEAST(25, v_overdue_days * 8);
  ELSE
    v_days_until_due := GREATEST(0, EXTRACT(EPOCH FROM (p_next_review_date - NOW())) / 86400.0);
    v_due_component := GREATEST(0, 30 - LEAST(30, v_days_until_due * 5));
  END IF;

  v_confidence_component := GREATEST(0, (1 - COALESCE(p_confidence, 0.5)) * 25);
  v_stubborn_component := CASE WHEN COALESCE(p_stubborn_flag, FALSE) THEN 12 ELSE 0 END;
  v_review_component := LEAST(8, GREATEST(0, COALESCE(p_review_count, 0)) * 0.8);
  v_state_component := CASE COALESCE(p_mastery_state, 'active')
    WHEN 'mastered' THEN 2
    ELSE 10
  END;

  v_score := ROUND(LEAST(100, GREATEST(0, v_due_component + v_confidence_component + v_stubborn_component + v_review_component + v_state_component)), 2);
  RETURN v_score;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_question_review_features()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.plan_source := COALESCE(NULLIF(TRIM(COALESCE(NEW.plan_source, '')), ''), 'rule_fallback');
  ELSE
    NEW.plan_source := COALESCE(NULLIF(TRIM(COALESCE(NEW.plan_source, '')), ''), NULLIF(TRIM(COALESCE(OLD.plan_source, '')), ''), 'rule_fallback');
  END IF;

  NEW.priority_score := public.compute_review_priority_score(
    NEW.next_review_date,
    NEW.confidence,
    NEW.stubborn_flag,
    NEW.review_count,
    NEW.mastery_state,
    NEW.is_archived
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_question_review_features ON public.questions;

CREATE TRIGGER trg_sync_question_review_features
BEFORE INSERT OR UPDATE OF next_review_date, confidence, stubborn_flag, review_count, mastery_state, is_archived, plan_source
ON public.questions
FOR EACH ROW
EXECUTE FUNCTION public.sync_question_review_features();

UPDATE public.questions
SET
  plan_source = COALESCE(NULLIF(TRIM(COALESCE(plan_source, '')), ''), 'rule_fallback'),
  priority_score = public.compute_review_priority_score(
    next_review_date,
    confidence,
    stubborn_flag,
    review_count,
    mastery_state,
    is_archived
  );

CREATE INDEX IF NOT EXISTS idx_questions_user_priority_score
  ON public.questions(user_id, priority_score DESC, next_review_date ASC)
  WHERE is_archived = FALSE;

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
  v_recent_attempt RECORD;
  v_previous_correct_streak INTEGER := 0;
  v_previous_wrong_streak INTEGER := 0;
  v_current_correct_streak INTEGER := 0;
  v_current_wrong_streak INTEGER := 0;
  v_recent_total INTEGER := 0;
  v_recent_correct INTEGER := 0;
  v_recent_accuracy NUMERIC := 0;
  v_previous_state TEXT;
  v_new_state TEXT;
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
  v_previous_state := COALESCE(v_question.mastery_state, CASE WHEN COALESCE(v_question.is_archived, FALSE) THEN 'archived' ELSE 'active' END);

  FOR v_recent_attempt IN
    SELECT is_correct
    FROM question_review_attempts
    WHERE question_id = v_question.id
      AND user_id = v_user
    ORDER BY created_at DESC
    LIMIT 12
  LOOP
    IF v_recent_total < 7 THEN
      v_recent_total := v_recent_total + 1;
      IF v_recent_attempt.is_correct THEN
        v_recent_correct := v_recent_correct + 1;
      END IF;
    END IF;

    IF v_previous_correct_streak = 0 THEN
      IF v_recent_attempt.is_correct THEN
        v_previous_correct_streak := v_previous_correct_streak + 1;
      ELSE
        v_previous_correct_streak := -1;
      END IF;
    END IF;

    IF v_previous_wrong_streak = 0 THEN
      IF NOT v_recent_attempt.is_correct THEN
        v_previous_wrong_streak := v_previous_wrong_streak + 1;
      ELSE
        v_previous_wrong_streak := -1;
      END IF;
    END IF;
  END LOOP;

  IF v_previous_correct_streak < 0 THEN
    v_previous_correct_streak := 0;
  END IF;
  IF v_previous_wrong_streak < 0 THEN
    v_previous_wrong_streak := 0;
  END IF;

  IF p_is_correct THEN
    IF p_rating = 'forgot' THEN
      v_new_confidence := LEAST(1, v_confidence + 0.02);
    ELSIF p_rating = 'vague' THEN
      v_new_confidence := LEAST(1, v_confidence + 0.06);
    ELSE
      v_new_confidence := LEAST(1, v_confidence + 0.12);
    END IF;
    v_new_confidence := LEAST(1, v_new_confidence + LEAST(0.06, v_previous_correct_streak * 0.01));
  ELSE
    IF p_rating = 'forgot' THEN
      v_new_confidence := GREATEST(0, v_confidence - 0.20);
    ELSIF p_rating = 'vague' THEN
      v_new_confidence := GREATEST(0, v_confidence - 0.10);
    ELSE
      v_new_confidence := GREATEST(0, v_confidence - 0.05);
    END IF;
  END IF;

  v_new_mastery := ROUND(v_new_confidence * 100);
  v_new_review_count := COALESCE(v_question.review_count, 0) + 1;

  v_recent_total := LEAST(8, v_recent_total + 1);
  IF p_is_correct THEN
    v_recent_correct := LEAST(8, v_recent_correct + 1);
    v_current_correct_streak := v_previous_correct_streak + 1;
    v_current_wrong_streak := 0;
  ELSE
    v_current_correct_streak := 0;
    v_current_wrong_streak := v_previous_wrong_streak + 1;
  END IF;
  v_recent_accuracy := v_recent_correct::NUMERIC / NULLIF(v_recent_total, 0);

  IF v_current_correct_streak >= 3 OR (v_recent_total >= 6 AND v_recent_accuracy >= 0.70) THEN
    v_stubborn := FALSE;
  ELSE
    v_stubborn := (v_current_wrong_streak >= 3) OR (v_new_review_count >= 6 AND v_recent_accuracy <= 0.35);
  END IF;

  IF NOT p_is_correct THEN
    v_new_state := 'active';
  ELSIF v_previous_state = 'mastered' AND v_current_correct_streak >= 6 AND v_recent_accuracy >= 0.90 AND v_new_mastery >= 93 THEN
    v_new_state := 'archived';
  ELSIF v_previous_state = 'archived' AND p_is_correct THEN
    v_new_state := 'archived';
  ELSIF v_new_mastery >= 90 AND v_current_correct_streak >= 4 AND v_recent_total >= 8 AND v_recent_accuracy >= 0.85 THEN
    v_new_state := 'mastered';
  ELSIF v_previous_state = 'mastered' AND p_is_correct AND v_new_mastery >= 88 THEN
    v_new_state := 'mastered';
  ELSE
    v_new_state := 'active';
  END IF;

  IF v_new_state = 'archived' THEN
    v_days := 120;
  ELSIF v_new_state = 'mastered' THEN
    IF v_current_correct_streak >= 6 THEN
      v_days := 60;
    ELSIF v_current_correct_streak >= 4 THEN
      v_days := 30;
    ELSE
      v_days := 14;
    END IF;
  ELSIF p_is_correct THEN
    IF p_rating = 'forgot' THEN
      v_days := 2;
    ELSIF p_rating = 'vague' THEN
      IF v_current_correct_streak >= 4 THEN
        v_days := 7;
      ELSE
        v_days := 3;
      END IF;
    ELSE
      IF v_current_correct_streak >= 6 THEN
        v_days := 30;
      ELSIF v_current_correct_streak >= 4 THEN
        v_days := 14;
      ELSIF v_current_correct_streak >= 2 THEN
        v_days := 7;
      ELSE
        v_days := 4;
      END IF;
    END IF;
  ELSE
    IF p_rating = 'mastered' THEN
      v_days := 2;
    ELSE
      v_days := 1;
    END IF;
  END IF;

  v_next_review := NOW() + make_interval(days => v_days);

  p_ai_diagnosis := jsonb_set(
    COALESCE(p_ai_diagnosis, '{}'::jsonb),
    '{engine}',
    jsonb_build_object(
      'correct_streak', v_current_correct_streak,
      'wrong_streak', v_current_wrong_streak,
      'recent_accuracy', ROUND(v_recent_accuracy * 100, 1),
      'stubborn_flag', v_stubborn,
      'mastery_state', v_new_state,
      'is_archived', (v_new_state = 'archived'),
      'plan_source', 'rule_fallback'
    )
  );

  UPDATE questions
  SET
    confidence = v_new_confidence,
    mastery_level = v_new_mastery,
    next_review_date = v_next_review,
    review_count = v_new_review_count,
    stubborn_flag = v_stubborn,
    mastery_state = v_new_state,
    mastered_at = CASE
      WHEN v_new_state = 'mastered' THEN COALESCE(mastered_at, NOW())
      WHEN v_new_state = 'active' THEN NULL
      ELSE mastered_at
    END,
    is_archived = (v_new_state = 'archived'),
    archived_at = CASE
      WHEN v_new_state = 'archived' THEN COALESCE(archived_at, NOW())
      ELSE NULL
    END,
    plan_source = 'rule_fallback',
    priority_score = public.compute_review_priority_score(
      v_next_review,
      v_new_confidence,
      v_stubborn,
      v_new_review_count,
      v_new_state,
      (v_new_state = 'archived')
    )
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
    p_ai_diagnosis,
    v_next_review
  )
  RETURNING id INTO v_attempt_id;

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
