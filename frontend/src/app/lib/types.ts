export interface KnowledgePoint {
  id: string;
  subject: string;
  name: string;
  created_at: string;
}

export interface Question {
  id: string;
  user_id: string;
  subject: string;
  question_text: string;
  category?: string;
  node?: string;
  image_url?: string;
  knowledge_point: string;
  ability: string;
  error_type: string;
  note?: string;
  summary?: string;
  mastery_level?: number;
  confidence?: number;
  next_review_date?: string;
  stubborn_flag?: boolean;
  created_at: string;
  review_count: number;
}

export interface UserWeakness {
  id: string;
  user_id: string;
  knowledge_point: string;
  ability: string;
  error_count: number;
  last_updated: string;
}

export const ENGLISH_KNOWLEDGE_POINTS = [
  "时态", "主谓一致", "从句", "被动语态", "非谓语动词", "介词", "冠词", "代词", "词义辨析", "词形变化", "固定搭配", "主旨理解", "细节理解", "推理判断", "句子结构", "逻辑连接", "表达准确"
];

export const PROGRAMMING_KNOWLEDGE_POINTS = [
  "变量与数据类型", "运算符与表达式", "选择结构", "循环结构", "函数", "数组与字符串", "指针", "结构体", "文件操作", "排序与查找", "代码阅读", "边界条件"
];

export const ABILITIES = ["识别", "理解", "应用", "表达"];

export const ERROR_TYPES = ["概念不清", "混淆", "粗心", "不熟练", "审题错误"];

export interface Stats {
  total: number;
  weaknessCount: number;
  topWeakness: UserWeakness | null;
  subjectCounts: Record<string, number>;
  newThisWeek: number;
  recent: Question[];
}

export interface QuestionCardData {
  subject: string;
  question_text: string;
  image_url?: string;
  knowledge_point: string;
  ability: string;
  error_type: string;
  note?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  reasoningContent?: string;
  thinking?: boolean;
  questionCard?: QuestionCardData;
  saved?: boolean;
}

export type Subject = '英语' | 'C语言';

export interface VariantQuestion {
  level: number;
  question_text: string;
  options: string[];
  correct_answer: string;
  explanation: string;
}

export interface QuestionQuery {
  subject?: string;
  category?: string;
  l2?: string;
  nodes?: string[];
  onlyDue?: boolean;
  onlyUnmastered?: boolean;
  onlyStubborn?: boolean;
  sortBy?: 'latestWrong' | 'lowestMastery' | 'nearestDue';
  limit?: number;
}
