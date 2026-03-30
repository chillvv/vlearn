-- Backfill mastery_level where it is null, using confidence or default 0.5
UPDATE questions 
SET mastery_level = ROUND(COALESCE(confidence, 0.5) * 100) 
WHERE mastery_level IS NULL;

-- Ensure confidence is also set if it was null
UPDATE questions 
SET confidence = 0.5 
WHERE confidence IS NULL;

-- We can also add an index on mastery_level to speed up the filtering and sorting
CREATE INDEX IF NOT EXISTS idx_questions_mastery_level_asc ON questions (user_id, mastery_level ASC);

-- Add a trigger to ensure mastery_level and confidence stay in sync?
-- Actually, our application logic and submit_review_attempt handles it. We can just rely on that for now,
-- but to be safe, we can add a check constraint or a trigger.
-- However, since the prompt only mentions data backfilling and index, this is enough.
