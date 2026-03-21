-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Questions Table (Supports Atomic Split)
CREATE TABLE IF NOT EXISTS questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  parent_id UUID REFERENCES questions(id) ON DELETE CASCADE, -- For atomic split (sub-questions)
  question TEXT NOT NULL,
  question_type TEXT NOT NULL, -- 'choice', 'fill', 'essay'
  options JSONB DEFAULT '[]'::jsonb,
  correct_answer TEXT,
  subject TEXT NOT NULL, -- Global Subject Switcher
  sub_topic TEXT,
  difficulty TEXT,
  analysis TEXT,
  summary TEXT, -- Forced summary (顿悟时刻)
  mastery_level INTEGER DEFAULT 0, -- 0: Red/Weak, 1: Green/Mastered
  review_count INTEGER DEFAULT 0,
  last_review TIMESTAMP WITH TIME ZONE,
  next_review TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Knowledge Nodes (Three-Level Archetype Tree)
CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE, -- NULL for system nodes, UUID for custom
  parent_id UUID REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  level INTEGER NOT NULL, -- 1: Module, 2: Chapter, 3: Micro-Skill/Archetype
  subject TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Question Tags (Binding Sub-questions to Level 3 Knowledge Nodes)
CREATE TABLE IF NOT EXISTS question_tags (
  question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
  node_id UUID REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, node_id)
);

-- Enable RLS for questions
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_tags ENABLE ROW LEVEL SECURITY;

-- Policies for questions
CREATE POLICY "Users can manage their own questions" 
  ON questions 
  FOR ALL 
  USING (auth.uid() = user_id) 
  WITH CHECK (auth.uid() = user_id);

-- Policies for knowledge_nodes
CREATE POLICY "Users can view system nodes and their own nodes" 
  ON knowledge_nodes 
  FOR SELECT 
  USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Users can create their own nodes" 
  ON knowledge_nodes 
  FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own nodes" 
  ON knowledge_nodes 
  FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own nodes" 
  ON knowledge_nodes 
  FOR DELETE 
  USING (auth.uid() = user_id);

-- Policies for question_tags
CREATE POLICY "Users can manage their own question tags" 
  ON question_tags 
  FOR ALL 
  USING (EXISTS (SELECT 1 FROM questions WHERE questions.id = question_id AND questions.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM questions WHERE questions.id = question_id AND questions.user_id = auth.uid()));

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
