import type { QuestionNormalizedPayload, QuestionType, RenderMode, ValidationStatus } from './questionPayload';

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
  question_type?: QuestionType;
  correct_answer?: string;
  note?: string;
  summary?: string;
  mastery_level?: number;
  confidence?: number;
  next_review_date?: string;
  stubborn_flag?: boolean;
  mastery_state?: 'active' | 'mastered' | 'archived';
  mastered_at?: string;
  is_archived?: boolean;
  archived_at?: string;
  created_at: string;
  review_count: number;
  raw_ai_response?: string;
  normalized_payload?: QuestionNormalizedPayload | null;
  payload_version?: string;
  validation_status?: ValidationStatus;
  render_mode?: RenderMode;
}

export interface UserWeakness {
  id: string;
  user_id: string;
  knowledge_point: string;
  ability: string;
  error_count: number;
  last_updated: string;
}

export type Subject = '英语' | 'C语言';

export const ENGLISH_KNOWLEDGE_POINTS = [
  '时态',
  '主谓一致',
  '虚拟语气',
  '从句',
  '被动语态',
  '非谓语动词',
  '介词',
  '冠词',
  '代词',
  '词形变化',
  '词义辨析',
  '固定搭配',
  '主旨理解',
  '细节理解',
  '推理判断',
  '句子结构',
  '逻辑连接',
  '表达准确',
];

export const PROGRAMMING_KNOWLEDGE_POINTS = [
  '变量与数据类型',
  '运算符与表达式',
  '选择结构',
  '循环结构',
  '函数',
  '数组',
  '字符串',
  '指针',
  '结构体',
  '文件操作',
  '排序与查找',
  '内存管理',
  '边界条件',
];

export const ABILITIES = ['知识点定位', '规则应用', '步骤执行', '表达输出'];

export const SUBJECT_ERROR_TYPES: Record<Subject, string[]> = {
  英语: [
    '时态',
    '主谓一致',
    '虚拟语气',
    '从句',
    '非谓语动词',
    '词义辨析',
    '固定搭配',
    '阅读主旨',
    '阅读细节',
    '阅读推理',
    '写作表达',
  ],
  C语言: [
    '数据类型',
    '运算表达式',
    '分支循环',
    '函数调用',
    '数组',
    '字符串',
    '指针',
    '结构体',
    '文件操作',
    '内存管理',
    '边界条件',
    '排序查找',
  ],
};

export const ERROR_TYPES = Array.from(new Set([...SUBJECT_ERROR_TYPES.英语, ...SUBJECT_ERROR_TYPES.C语言]));

export function getKnowledgePointsBySubject(subject?: string) {
  if (subject === 'C语言') return PROGRAMMING_KNOWLEDGE_POINTS;
  return ENGLISH_KNOWLEDGE_POINTS;
}

export function getErrorTypesBySubject(subject?: string) {
  if (subject === 'C语言') return SUBJECT_ERROR_TYPES.C语言;
  return SUBJECT_ERROR_TYPES.英语;
}

export interface Stats {
  total: number;
  weaknessCount: number;
  dueReviewCount: number;
  topWeakness: UserWeakness | null;
  subjectCounts: Record<string, number>;
  newThisWeek: number;
  recent: Question[];
  subjectMastery: { subject: string; score: number; count: number }[];
  weeklyActivity: number[];
  errorTypes: { name: string; value: number }[];
  weaknessesList: UserWeakness[];
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

export interface VariantQuestion {
  level: number;
  question_type: QuestionType;
  question_text: string;
  options: string[];
  correct_answer: string;
  acceptable_answers?: string[];
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
  includeArchived?: boolean;
  onlyArchived?: boolean;
  sortBy?: 'latestWrong' | 'lowestMastery' | 'nearestDue';
  offset?: number;
  limit?: number;
}

export type ReviewRating = 'forgot' | 'vague' | 'mastered';

export interface ReviewAttemptDiagnosis {
  why_wrong: string;
  evidence: string;
  fix_strategy: string;
  next_practice_type: string;
  error_pattern?: 'repeat_same_option' | 'keyword_missing' | 'knowledge_gap' | 'careless' | 'unknown';
  confidence_score?: number;
  history_hint?: string;
}

export interface ReviewAttemptRecord {
  id: string;
  question_id: string;
  user_answer?: string;
  selected_option_text?: string;
  correct_answer?: string;
  is_correct: boolean;
  rating: ReviewRating;
  ai_diagnosis?: ReviewAttemptDiagnosis | null;
  next_review_date?: string;
  created_at: string;
}

export interface SubmitReviewAttemptInput {
  questionId: string;
  userAnswer: string;
  selectedOptionText?: string;
  correctAnswer?: string;
  isCorrect: boolean;
  rating: ReviewRating;
  diagnosis: ReviewAttemptDiagnosis;
}

export interface SubmitReviewAttemptResult {
  question: Question;
  attemptId?: string;
  nextReviewDate?: string;
}

export interface GenerateReviewDiagnosisInput {
  subject?: string;
  questionText: string;
  correctAnswer: string;
  userAnswer: string;
  selectedOptionText?: string;
  isChoice: boolean;
  recentAttempts?: Array<{
    is_correct: boolean;
    user_answer?: string;
    rating?: ReviewRating;
    created_at?: string;
  }>;
  fallbackDiagnosis: ReviewAttemptDiagnosis;
}

export type TagExtensions = Partial<Record<'knowledge_point' | 'ability' | 'error_type', string[]>>;

export type TaxonomyOverrideMap = Partial<Record<Subject, Record<string, { category: string; branch: string; node: string }>>>;

export interface LearningDrawerContent {
  title?: string;
  summary?: string;
  tables?: any[];
  markdown?: string;
}

export interface LearningContentState {
  tipsByNode: Record<string, string[]>;
  drawerByTag: Record<string, LearningDrawerContent>;
}

export interface UserLearningStateRecord {
  user_id: string;
  tag_extensions: TagExtensions;
  taxonomy_overrides: TaxonomyOverrideMap;
  learning_content: LearningContentState;
  created_at?: string;
  updated_at?: string;
}
