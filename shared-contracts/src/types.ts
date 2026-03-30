export interface Question {
  id: string;
  user_id?: string;
  subject: string;
  question_text: string;
  category?: string;
  node?: string;
  image_url?: string;
  knowledge_point: string;
  ability: string;
  error_type: string;
  question_type?: string;
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
}

export interface UserWeakness {
  id: string;
  user_id: string;
  knowledge_point: string;
  ability: string;
  error_count: number;
  last_updated: string;
}

export interface Stats {
  total: number;
  weaknessCount: number;
  dueReviewCount: number;
  topWeakness: UserWeakness | null;
  subjectCounts: Record<string, number>;
  newThisWeek: number;
  recent: Question[];
  subjectMastery: Array<{
    subject: string;
    score: number;
    count: number;
  }>;
  weeklyActivity: number[];
  errorTypes: Array<{
    name: string;
    value: number;
  }>;
  weaknessesList: UserWeakness[];
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
