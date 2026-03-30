DROP FUNCTION IF EXISTS public.get_global_error_stats(INTEGER);

CREATE OR REPLACE FUNCTION public.get_global_error_stats(p_days INTEGER DEFAULT 7)
RETURNS TABLE (
  date_key DATE,
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
    (date_trunc('day', created_at AT TIME ZONE 'UTC'))::DATE AS date_key,
    to_char(created_at AT TIME ZONE 'UTC', 'MM-DD') AS date_label,
    (ai_diagnosis->>'error_pattern')::TEXT AS error_pattern,
    COUNT(*)::INTEGER AS count
  FROM question_review_attempts
  WHERE user_id = v_user
    AND is_correct = false
    AND created_at >= NOW() - (GREATEST(p_days, 1) || ' days')::INTERVAL
    AND ai_diagnosis->>'error_pattern' IS NOT NULL
  GROUP BY
    (date_trunc('day', created_at AT TIME ZONE 'UTC'))::DATE,
    to_char(created_at AT TIME ZONE 'UTC', 'MM-DD'),
    (ai_diagnosis->>'error_pattern')::TEXT
  ORDER BY
    (date_trunc('day', created_at AT TIME ZONE 'UTC'))::DATE ASC,
    (ai_diagnosis->>'error_pattern')::TEXT ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_global_error_stats(INTEGER) TO authenticated;
