import type { Question, Stats, UserWeakness } from './types';

function normalizeQuestionRow(row: Record<string, unknown>): Question {
  return {
    id: String(row.id || ''),
    user_id: typeof row.user_id === 'string' ? row.user_id : undefined,
    subject: typeof row.subject === 'string' ? row.subject : '未知',
    question_text:
      typeof row.question_text === 'string'
        ? row.question_text
        : typeof row.question === 'string'
          ? row.question
          : '未填写题目内容',
    category: typeof row.category === 'string' ? row.category : undefined,
    node: typeof row.node === 'string' ? row.node : undefined,
    image_url: typeof row.image_url === 'string' ? row.image_url : undefined,
    knowledge_point: typeof row.knowledge_point === 'string' ? row.knowledge_point : '未标注知识点',
    ability: typeof row.ability === 'string' ? row.ability : '未标注能力',
    error_type: typeof row.error_type === 'string' ? row.error_type : '未分类',
    question_type: typeof row.question_type === 'string' ? row.question_type : undefined,
    correct_answer: typeof row.correct_answer === 'string' ? row.correct_answer : undefined,
    note: typeof row.note === 'string' ? row.note : undefined,
    summary: typeof row.summary === 'string' ? row.summary : undefined,
    mastery_level: typeof row.mastery_level === 'number' ? row.mastery_level : undefined,
    confidence: typeof row.confidence === 'number' ? row.confidence : undefined,
    next_review_date: typeof row.next_review_date === 'string' ? row.next_review_date : undefined,
    stubborn_flag: typeof row.stubborn_flag === 'boolean' ? row.stubborn_flag : undefined,
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date(0).toISOString(),
    review_count: typeof row.review_count === 'number' ? row.review_count : 0,
  };
}

export function createEmptyStats(): Stats {
  return {
    total: 0,
    weaknessCount: 0,
    dueReviewCount: 0,
    topWeakness: null,
    subjectCounts: {},
    newThisWeek: 0,
    recent: [],
    subjectMastery: [],
    weeklyActivity: [0, 0, 0, 0, 0, 0, 0],
    errorTypes: [],
    weaknessesList: [],
  };
}

export function normalizeDashboardStatsFromRpc(raw: unknown): Stats | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const subjectCounts = (record.subject_counts || {}) as Record<string, number>;
  const weeklyActivity = Array.isArray(record.weekly_activity) ? record.weekly_activity.map((item) => Number(item || 0)) : [0, 0, 0, 0, 0, 0, 0];
  const errorTypes = Array.isArray(record.error_types)
    ? record.error_types.map((item) => ({
        name: String((item as { name?: unknown })?.name || '未分类'),
        value: Number((item as { value?: unknown })?.value || 0),
      }))
    : [];
  const subjectMastery = Array.isArray(record.subject_mastery)
    ? record.subject_mastery.map((item) => ({
        subject: String((item as { subject?: unknown })?.subject || '未知'),
        count: Number((item as { count?: unknown })?.count || 0),
        score: Number((item as { score?: unknown })?.score || 0),
      }))
    : [];
  const weaknessesList = Array.isArray(record.weaknesses_list) ? (record.weaknesses_list as UserWeakness[]) : [];
  const recent = Array.isArray(record.recent)
    ? record.recent.map((item) => normalizeQuestionRow(item as Record<string, unknown>))
    : [];

  return {
    total: Number(record.total || 0),
    weaknessCount: Number(record.weakness_count || 0),
    dueReviewCount: Number(record.due_review_count || 0),
    topWeakness: (record.top_weakness as UserWeakness | null) || null,
    subjectCounts,
    newThisWeek: Number(record.new_this_week || 0),
    recent,
    subjectMastery,
    weeklyActivity,
    errorTypes,
    weaknessesList,
  };
}
