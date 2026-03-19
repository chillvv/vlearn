-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Questions Table
CREATE TABLE IF NOT EXISTS questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  question TEXT NOT NULL,
  question_type TEXT NOT NULL, -- 'choice', 'fill', 'essay'
  options JSONB DEFAULT '[]'::jsonb,
  correct_answer TEXT,
  subject TEXT NOT NULL,
  sub_topic TEXT,
  error_tag TEXT,
  difficulty TEXT,
  analysis TEXT,
  knowledge TEXT,
  mastery_level INTEGER DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  last_review TIMESTAMP WITH TIME ZONE,
  next_review TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for questions
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;

-- Policies for questions
CREATE POLICY "Users can manage their own questions" 
  ON questions 
  FOR ALL 
  USING (auth.uid() = user_id) 
  WITH CHECK (auth.uid() = user_id);

-- Shared Questions Table (For Export/Import/Share functionality)
CREATE TABLE IF NOT EXISTS shared_questions (
  code TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  questions JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Enable RLS for shared_questions
ALTER TABLE shared_questions ENABLE ROW LEVEL SECURITY;

-- Policies for shared_questions
CREATE POLICY "Anyone can view valid shared questions" 
  ON shared_questions 
  FOR SELECT 
  USING (NOW() < expires_at);

CREATE POLICY "Users can create their own shares" 
  ON shared_questions 
  FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own shares" 
  ON shared_questions 
  FOR DELETE 
  USING (auth.uid() = user_id);

-- Function to automatically update the 'updated_at' column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to call the function before update
DROP TRIGGER IF EXISTS update_questions_updated_at ON questions;
CREATE TRIGGER update_questions_updated_at
    BEFORE UPDATE ON questions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
