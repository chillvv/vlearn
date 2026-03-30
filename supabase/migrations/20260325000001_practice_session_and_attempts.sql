CREATE TABLE IF NOT EXISTS practice_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  subject TEXT NOT NULL,
  strategy TEXT NOT NULL,
  nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
  planned_amount INTEGER NOT NULL DEFAULT 0,
  generated_amount INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  total_elapsed_seconds INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE practice_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own practice sessions"
  ON practice_sessions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS practice_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_id UUID REFERENCES practice_sessions(id) ON DELETE CASCADE NOT NULL,
  question_index INTEGER NOT NULL,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL,
  correct_answer TEXT,
  user_answer TEXT,
  is_correct BOOLEAN NOT NULL DEFAULT FALSE,
  knowledge_point TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE practice_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own practice attempts"
  ON practice_attempts
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_practice_sessions_user_created
  ON practice_sessions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_practice_attempts_session
  ON practice_attempts(session_id);

CREATE OR REPLACE FUNCTION increment_user_weakness(p_knowledge_point TEXT, p_ability TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  INSERT INTO user_weakness (user_id, knowledge_point, ability, error_count, last_updated)
  VALUES (v_user, p_knowledge_point, p_ability, 1, NOW())
  ON CONFLICT (user_id, knowledge_point, ability)
  DO UPDATE SET
    error_count = user_weakness.error_count + 1,
    last_updated = NOW();
END;
$$;
