ALTER TABLE IF EXISTS public.questions
  ALTER COLUMN ability DROP NOT NULL,
  ALTER COLUMN error_type DROP NOT NULL;

UPDATE public.questions
SET ability = NULL,
    error_type = NULL
WHERE COALESCE(TRIM(ability), '') <> ''
   OR COALESCE(TRIM(error_type), '') <> '';

ALTER TABLE IF EXISTS public.user_weakness
  ALTER COLUMN ability DROP NOT NULL;

WITH ranked AS (
  SELECT
    id,
    user_id,
    knowledge_point,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, knowledge_point
      ORDER BY error_count DESC, last_updated DESC, id DESC
    ) AS rn
  FROM public.user_weakness
),
merged AS (
  SELECT
    user_id,
    knowledge_point,
    SUM(error_count)::int AS total_error_count,
    MAX(last_updated) AS max_last_updated
  FROM public.user_weakness
  GROUP BY user_id, knowledge_point
)
UPDATE public.user_weakness uw
SET
  error_count = merged.total_error_count,
  last_updated = merged.max_last_updated,
  ability = NULL
FROM ranked
JOIN merged
  ON merged.user_id = ranked.user_id
 AND merged.knowledge_point = ranked.knowledge_point
WHERE uw.id = ranked.id
  AND ranked.rn = 1;

DELETE FROM public.user_weakness uw
USING (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, knowledge_point
        ORDER BY error_count DESC, last_updated DESC, id DESC
      ) AS rn
    FROM public.user_weakness
  ) t
  WHERE t.rn > 1
) dup
WHERE uw.id = dup.id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_weakness_user_id_knowledge_point_ability_key'
  ) THEN
    ALTER TABLE public.user_weakness
      DROP CONSTRAINT user_weakness_user_id_knowledge_point_ability_key;
  END IF;
END $$;

ALTER TABLE IF EXISTS public.user_weakness
  ADD CONSTRAINT user_weakness_user_id_knowledge_point_key
  UNIQUE (user_id, knowledge_point);

DELETE FROM public.tag_dictionary_items
WHERE item_type IN ('ability', 'error_type');

UPDATE public.user_learning_state
SET tag_extensions = COALESCE(tag_extensions, '{}'::jsonb) - 'ability' - 'error_type';
