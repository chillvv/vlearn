-- 1.1 Update `questions` (Mistake) database schema to support 3-layer taxonomy tags
ALTER TABLE questions
ADD COLUMN IF NOT EXISTS category TEXT,
ADD COLUMN IF NOT EXISTS node TEXT;

-- Migrate existing knowledge_point to node if node is null
UPDATE questions SET node = knowledge_point WHERE node IS NULL;

-- 1.2 Update `questions` schema to include Ebbinghaus review fields
ALTER TABLE questions
ADD COLUMN IF NOT EXISTS next_review_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS ebbinghaus_interval INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS stubborn_flag BOOLEAN DEFAULT FALSE;

-- 1.3 Create `knowledge_nodes` schema for caching AI-generated "Tips & Tricks"
CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject TEXT NOT NULL,
  category TEXT NOT NULL,
  node TEXT NOT NULL,
  tips_and_tricks TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(subject, category, node)
);

-- Enable RLS for knowledge_nodes
ALTER TABLE knowledge_nodes ENABLE ROW LEVEL SECURITY;

-- Policies for knowledge_nodes (Readable by all authenticated users, editable by system/admin - for now, let's allow all auth users to read)
CREATE POLICY "Anyone can read knowledge nodes"
  ON knowledge_nodes
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- For simplicity in this app, allow authenticated users to insert/update knowledge nodes
CREATE POLICY "Authenticated users can insert knowledge nodes"
  ON knowledge_nodes
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update knowledge nodes"
  ON knowledge_nodes
  FOR UPDATE
  USING (auth.role() = 'authenticated');
