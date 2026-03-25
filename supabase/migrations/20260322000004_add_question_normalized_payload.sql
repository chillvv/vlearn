ALTER TABLE questions
ADD COLUMN IF NOT EXISTS question_type TEXT,
ADD COLUMN IF NOT EXISTS correct_answer TEXT,
ADD COLUMN IF NOT EXISTS raw_ai_response TEXT,
ADD COLUMN IF NOT EXISTS normalized_payload JSONB,
ADD COLUMN IF NOT EXISTS payload_version TEXT DEFAULT 'v1',
ADD COLUMN IF NOT EXISTS validation_status TEXT DEFAULT 'valid',
ADD COLUMN IF NOT EXISTS render_mode TEXT DEFAULT 'structured';

UPDATE questions
SET validation_status = COALESCE(validation_status, 'valid'),
    render_mode = COALESCE(render_mode, 'structured'),
    payload_version = COALESCE(payload_version, 'v1');

CREATE INDEX IF NOT EXISTS idx_questions_validation_status ON questions(validation_status);
CREATE INDEX IF NOT EXISTS idx_questions_render_mode ON questions(render_mode);
