-- Drop old questions table to recreate
DROP TABLE IF EXISTS questions CASCADE;

-- Create knowledge_points table
CREATE TABLE IF NOT EXISTS knowledge_points (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(subject, name)
);

-- Insert predefined knowledge points for English
INSERT INTO knowledge_points (subject, name) VALUES
('英语', '时态'),
('英语', '主谓一致'),
('英语', '从句'),
('英语', '被动语态'),
('英语', '非谓语动词'),
('英语', '介词'),
('英语', '冠词'),
('英语', '代词'),
('英语', '词义辨析'),
('英语', '词形变化'),
('英语', '固定搭配'),
('英语', '主旨理解'),
('英语', '细节理解'),
('英语', '推理判断'),
('英语', '句子结构'),
('英语', '逻辑连接'),
('英语', '表达准确')
ON CONFLICT (subject, name) DO NOTHING;

-- Insert predefined knowledge points for Programming
INSERT INTO knowledge_points (subject, name) VALUES
('编程', '变量'),
('编程', '数据类型'),
('编程', '条件判断'),
('编程', '循环'),
('编程', '函数'),
('编程', '逻辑理解'),
('编程', '代码阅读'),
('编程', '调试'),
('编程', '数据结构'),
('编程', '算法')
ON CONFLICT (subject, name) DO NOTHING;

-- Create new questions table
CREATE TABLE IF NOT EXISTS questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  subject TEXT NOT NULL,
  question_text TEXT,
  image_url TEXT,
  knowledge_point TEXT NOT NULL,
  ability TEXT NOT NULL,
  error_type TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  review_count INTEGER DEFAULT 0
);

-- Enable RLS for questions
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;

-- Policies for questions
CREATE POLICY "Users can manage their own questions" 
  ON questions 
  FOR ALL 
  USING (auth.uid() = user_id) 
  WITH CHECK (auth.uid() = user_id);

-- Create user_weakness table
CREATE TABLE IF NOT EXISTS user_weakness (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  knowledge_point TEXT NOT NULL,
  ability TEXT NOT NULL,
  error_count INTEGER DEFAULT 0,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, knowledge_point, ability)
);

-- Enable RLS for user_weakness
ALTER TABLE user_weakness ENABLE ROW LEVEL SECURITY;

-- Policies for user_weakness
CREATE POLICY "Users can manage their own weakness stats" 
  ON user_weakness 
  FOR ALL 
  USING (auth.uid() = user_id) 
  WITH CHECK (auth.uid() = user_id);
