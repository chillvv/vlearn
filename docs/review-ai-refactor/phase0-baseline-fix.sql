UPDATE public.questions
SET next_review_date = COALESCE(next_review_date, NOW())
WHERE mastery_state = 'active'
  AND next_review_date IS NULL;
