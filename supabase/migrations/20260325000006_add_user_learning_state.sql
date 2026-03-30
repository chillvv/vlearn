CREATE TABLE IF NOT EXISTS user_learning_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tag_extensions JSONB NOT NULL DEFAULT '{}'::jsonb,
  taxonomy_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  learning_content JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE user_learning_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own learning state" ON user_learning_state;
CREATE POLICY "Users can manage their own learning state"
  ON user_learning_state
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
