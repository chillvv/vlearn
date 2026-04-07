ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS stability NUMERIC(8, 2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS difficulty NUMERIC(4, 3) NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS last_interval_days NUMERIC(8, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lapse_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS predicted_recall NUMERIC(4, 3) NOT NULL DEFAULT 0.5;

ALTER TABLE public.questions
  DROP CONSTRAINT IF EXISTS questions_stability_check,
  DROP CONSTRAINT IF EXISTS questions_difficulty_check,
  DROP CONSTRAINT IF EXISTS questions_last_interval_days_check,
  DROP CONSTRAINT IF EXISTS questions_lapse_count_check,
  DROP CONSTRAINT IF EXISTS questions_predicted_recall_check;

ALTER TABLE public.questions
  ADD CONSTRAINT questions_stability_check CHECK (stability >= 0),
  ADD CONSTRAINT questions_difficulty_check CHECK (difficulty >= 0 AND difficulty <= 1),
  ADD CONSTRAINT questions_last_interval_days_check CHECK (last_interval_days >= 0),
  ADD CONSTRAINT questions_lapse_count_check CHECK (lapse_count >= 0),
  ADD CONSTRAINT questions_predicted_recall_check CHECK (predicted_recall >= 0 AND predicted_recall <= 1);

CREATE OR REPLACE FUNCTION public.compute_review_predicted_recall(
  p_confidence NUMERIC DEFAULT NULL,
  p_stability NUMERIC DEFAULT NULL,
  p_last_interval_days NUMERIC DEFAULT NULL,
  p_lapse_count INTEGER DEFAULT 0,
  p_next_review_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  p_mastery_state TEXT DEFAULT 'active',
  p_is_archived BOOLEAN DEFAULT FALSE
)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
  v_score NUMERIC := 0;
  v_due_delta NUMERIC := 0;
BEGIN
  IF COALESCE(p_is_archived, FALSE) OR COALESCE(p_mastery_state, 'active') = 'archived' THEN
    RETURN 0.98;
  END IF;

  v_score :=
    COALESCE(p_confidence, 0.5) * 0.55
    + LEAST(1, COALESCE(p_stability, 1) / 30) * 0.25
    + LEAST(1, COALESCE(p_last_interval_days, 0) / 21) * 0.08
    + CASE COALESCE(p_mastery_state, 'active')
        WHEN 'mastered' THEN 0.05
        ELSE 0
      END
    - LEAST(0.30, GREATEST(0, COALESCE(p_lapse_count, 0)) * 0.06);

  IF p_next_review_date IS NOT NULL THEN
    IF p_next_review_date <= NOW() THEN
      v_due_delta := GREATEST(0, EXTRACT(EPOCH FROM (NOW() - p_next_review_date)) / 86400.0);
      v_score := v_score - LEAST(0.20, v_due_delta * 0.025);
    ELSE
      v_due_delta := GREATEST(0, EXTRACT(EPOCH FROM (p_next_review_date - NOW())) / 86400.0);
      v_score := v_score + LEAST(0.04, v_due_delta * 0.002);
    END IF;
  END IF;

  RETURN ROUND(LEAST(1, GREATEST(0, v_score)), 3);
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

  NEW.stability := ROUND(GREATEST(0, COALESCE(NEW.stability, 1)), 2);
  NEW.difficulty := ROUND(LEAST(1, GREATEST(0, COALESCE(NEW.difficulty, 0.5))), 3);
  NEW.last_interval_days := ROUND(GREATEST(0, COALESCE(NEW.last_interval_days, 0)), 2);
  NEW.lapse_count := GREATEST(0, COALESCE(NEW.lapse_count, 0));
  NEW.predicted_recall := public.compute_review_predicted_recall(
    NEW.confidence,
    NEW.stability,
    NEW.last_interval_days,
    NEW.lapse_count,
    NEW.next_review_date,
    NEW.mastery_state,
    NEW.is_archived
  );
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
BEFORE INSERT OR UPDATE OF next_review_date, confidence, stubborn_flag, review_count, mastery_state, is_archived, plan_source, stability, difficulty, last_interval_days, lapse_count
ON public.questions
FOR EACH ROW
EXECUTE FUNCTION public.sync_question_review_features();

WITH last_attempt AS (
  SELECT question_id, created_at, is_correct, rating
  FROM (
    SELECT
      question_id,
      created_at,
      is_correct,
      rating,
      ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY created_at DESC) AS rn
    FROM public.question_review_attempts
  ) ranked
  WHERE rn = 1
),
previous_attempt AS (
  SELECT question_id, created_at
  FROM (
    SELECT
      question_id,
      created_at,
      ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY created_at DESC) AS rn
    FROM public.question_review_attempts
  ) ranked
  WHERE rn = 2
),
attempt_summary AS (
  SELECT
    q.id,
    ROUND(
      GREATEST(
        0,
        COALESCE(EXTRACT(EPOCH FROM (COALESCE(la.created_at, NOW()) - COALESCE(pa.created_at, q.created_at))) / 86400.0, 0)
      )::numeric,
      2
    ) AS computed_last_interval_days,
    COALESCE(SUM(CASE WHEN a.is_correct = FALSE OR a.rating = 'forgot' THEN 1 ELSE 0 END), 0)::int AS computed_lapse_count,
    ROUND(
      LEAST(
        365,
        GREATEST(
          0.2,
          1
          + COALESCE(q.review_count, 0) * 0.6
          + ROUND(
            GREATEST(
              0,
              COALESCE(EXTRACT(EPOCH FROM (COALESCE(la.created_at, NOW()) - COALESCE(pa.created_at, q.created_at))) / 86400.0, 0)
            )::numeric,
            2
          ) * 0.35
          - COALESCE(SUM(CASE WHEN a.is_correct = FALSE OR a.rating = 'forgot' THEN 1 ELSE 0 END), 0)::numeric * 0.9
          + CASE COALESCE(q.mastery_state, 'active')
              WHEN 'mastered' THEN 8
              WHEN 'archived' THEN 12
              ELSE 0
            END
        )
      ),
      2
    ) AS computed_stability,
    ROUND(
      LEAST(
        1,
        GREATEST(
          0,
          0.25
          + (1 - COALESCE(q.confidence, 0.5)) * 0.45
          + LEAST(0.30, COALESCE(SUM(CASE WHEN a.is_correct = FALSE OR a.rating = 'forgot' THEN 1 ELSE 0 END), 0)::numeric * 0.05)
          + CASE
              WHEN la.question_id IS NULL THEN 0
              WHEN la.is_correct THEN -0.04
              ELSE 0.08
            END
        )
      ),
      3
    ) AS computed_difficulty
  FROM public.questions q
  LEFT JOIN public.question_review_attempts a
    ON a.question_id = q.id
  LEFT JOIN last_attempt la
    ON la.question_id = q.id
  LEFT JOIN previous_attempt pa
    ON pa.question_id = q.id
  GROUP BY q.id, q.created_at, q.review_count, q.mastery_state, q.confidence, la.question_id, la.created_at, la.is_correct, pa.created_at
)
UPDATE public.questions q
SET
  last_interval_days = summary.computed_last_interval_days,
  lapse_count = summary.computed_lapse_count,
  stability = summary.computed_stability,
  difficulty = summary.computed_difficulty
FROM attempt_summary summary
WHERE q.id = summary.id;

UPDATE public.questions
SET
  predicted_recall = public.compute_review_predicted_recall(
    confidence,
    stability,
    last_interval_days,
    lapse_count,
    next_review_date,
    mastery_state,
    is_archived
  ),
  priority_score = public.compute_review_priority_score(
    next_review_date,
    confidence,
    stubborn_flag,
    review_count,
    mastery_state,
    is_archived
  );

CREATE INDEX IF NOT EXISTS idx_questions_user_predicted_recall
  ON public.questions(user_id, predicted_recall DESC, next_review_date ASC)
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
  v_last_attempt_at TIMESTAMP WITH TIME ZONE;
  v_new_last_interval_days NUMERIC := 0;
  v_new_lapse_count INTEGER := 0;
  v_new_stability NUMERIC := 1;
  v_new_difficulty NUMERIC := 0.5;
  v_new_predicted_recall NUMERIC := 0.5;
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

  SELECT created_at
    INTO v_last_attempt_at
  FROM question_review_attempts
  WHERE question_id = v_question.id
    AND user_id = v_user
  ORDER BY created_at DESC
  LIMIT 1;

  v_new_last_interval_days := ROUND(
    GREATEST(
      0,
      COALESCE(EXTRACT(EPOCH FROM (NOW() - COALESCE(v_last_attempt_at, v_question.created_at))) / 86400.0, 0)
    )::numeric,
    2
  );
  v_new_lapse_count := GREATEST(
    0,
    COALESCE(v_question.lapse_count, 0) + CASE WHEN (NOT p_is_correct) OR p_rating = 'forgot' THEN 1 ELSE 0 END
  );

  IF p_is_correct THEN
    v_new_stability := LEAST(
      365,
      GREATEST(
        0.2,
        COALESCE(v_question.stability, 1)
        + CASE p_rating
            WHEN 'forgot' THEN 0.6
            WHEN 'vague' THEN 1.4
            ELSE 2.4
          END
        + LEAST(6, v_new_last_interval_days * 0.25)
        - LEAST(2.5, COALESCE(v_question.lapse_count, 0) * 0.15)
      )
    );
    v_new_difficulty := LEAST(
      1,
      GREATEST(
        0,
        COALESCE(v_question.difficulty, 0.5)
        - CASE p_rating
            WHEN 'mastered' THEN 0.06
            WHEN 'vague' THEN 0.03
            ELSE 0.01
          END
        - LEAST(0.03, v_current_correct_streak * 0.005)
      )
    );
  ELSE
    v_new_stability := GREATEST(
      0.2,
      COALESCE(v_question.stability, 1)
      * CASE p_rating
          WHEN 'forgot' THEN 0.55
          WHEN 'vague' THEN 0.70
          ELSE 0.80
        END
    );
    v_new_difficulty := LEAST(
      1,
      GREATEST(
        0,
        COALESCE(v_question.difficulty, 0.5)
        + CASE p_rating
            WHEN 'forgot' THEN 0.12
            WHEN 'vague' THEN 0.08
            ELSE 0.05
          END
        + LEAST(0.05, v_current_wrong_streak * 0.01)
      )
    );
  END IF;

  IF v_new_state = 'mastered' THEN
    v_new_stability := LEAST(365, v_new_stability + 6);
  ELSIF v_new_state = 'archived' THEN
    v_new_stability := LEAST(365, v_new_stability + 12);
  END IF;

  v_new_stability := ROUND(v_new_stability, 2);
  v_new_difficulty := ROUND(v_new_difficulty, 3);
  v_next_review := NOW() + make_interval(days => v_days);
  v_new_predicted_recall := public.compute_review_predicted_recall(
    v_new_confidence,
    v_new_stability,
    v_new_last_interval_days,
    v_new_lapse_count,
    v_next_review,
    v_new_state,
    (v_new_state = 'archived')
  );

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
      'plan_source', 'rule_fallback',
      'last_interval_days', v_new_last_interval_days,
      'lapse_count', v_new_lapse_count,
      'stability', v_new_stability,
      'difficulty', v_new_difficulty,
      'predicted_recall', v_new_predicted_recall
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
    last_interval_days = v_new_last_interval_days,
    lapse_count = v_new_lapse_count,
    stability = v_new_stability,
    difficulty = v_new_difficulty,
    predicted_recall = v_new_predicted_recall,
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
