import type { QuestionQuery } from './types';

type Primitive = string | number | boolean | null;
type JsonValue = Primitive | JsonValue[] | { [key: string]: JsonValue };

function normalizeValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source).sort();
    const out: Record<string, JsonValue> = {};
    keys.forEach((key) => {
      const next = source[key];
      if (next === undefined) return;
      out[key] = normalizeValue(next);
    });
    return out;
  }
  return String(value);
}

function normalizeQuestionQuery(query: QuestionQuery = {}) {
  return normalizeValue(query);
}

export const queryKeys = {
  questionsList: (query: QuestionQuery = {}) => ['questions', 'list', normalizeQuestionQuery(query)] as const,
  questionsCount: (query: QuestionQuery = {}) => ['questions', 'count', normalizeQuestionQuery(query)] as const,
  questionsDueCount: (subject?: string) => ['questions', 'due-count', subject || 'all'] as const,
  recentAttempts: (questionId?: string, limit = 6) => ['questions', 'recent-attempts', questionId || 'none', limit] as const,
  dashboardStats: () => ['dashboard', 'stats'] as const,
  knowledgeNodeMastery: (subject: string) => ['knowledge', 'node-mastery', subject] as const,
  globalErrorStats: (days: number) => ['review', 'global-error-stats', days] as const,
};
