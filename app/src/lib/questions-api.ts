import type { Question } from '@aiweb/mobile-shared';
import { isLocalApiMode } from './data-access';
import { localApiRequest } from './local-data-api';
import { supabase } from './supabase';

export interface CreateQuestionInput {
  subject: string;
  questionText: string;
  knowledgePoint: string;
  ability: string;
  errorType: string;
  correctAnswer?: string;
  note?: string;
  summary?: string;
  imageUrl?: string;
  category?: string;
  node?: string;
  questionType?: string;
  rawAiResponse?: string;
  normalizedPayload?: Record<string, unknown> | null;
  confidence?: number;
}

export function normalizeQuestionRow(row: Record<string, unknown>): Question {
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
    correct_answer: typeof row.correct_answer === 'string' ? row.correct_answer : undefined,
    note: typeof row.note === 'string' ? row.note : undefined,
    summary: typeof row.summary === 'string' ? row.summary : undefined,
    mastery_level: typeof row.mastery_level === 'number' ? row.mastery_level : undefined,
    confidence: typeof row.confidence === 'number' ? row.confidence : undefined,
    next_review_date: typeof row.next_review_date === 'string' ? row.next_review_date : undefined,
    stubborn_flag: typeof row.stubborn_flag === 'boolean' ? row.stubborn_flag : undefined,
    mastery_state:
      row.mastery_state === 'active' || row.mastery_state === 'mastered' || row.mastery_state === 'archived'
        ? row.mastery_state
        : undefined,
    mastered_at: typeof row.mastered_at === 'string' ? row.mastered_at : undefined,
    is_archived: typeof row.is_archived === 'boolean' ? row.is_archived : undefined,
    archived_at: typeof row.archived_at === 'string' ? row.archived_at : undefined,
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date(0).toISOString(),
    review_count: typeof row.review_count === 'number' ? row.review_count : 0,
  };
}

export async function getDueQuestions(limit = 20): Promise<Question[]> {
  if (isLocalApiMode()) {
    try {
      const rows = await localApiRequest<Record<string, unknown>[]>(
        `/questions?onlyDue=1&limit=${Math.max(1, Math.min(limit, 100))}&includeArchived=0`,
      );
      return (rows || []).map((item) => normalizeQuestionRow(item));
    } catch (error) {
      if (String((error as Error)?.message || '').includes('请先登录')) {
        return [];
      }
      throw error;
    }
  }
  if (!supabase) {
    return [];
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    throw new Error(authError.message);
  }

  const user = authData.user;
  if (!user) {
    return [];
  }

  const nowIso = new Date().toISOString();
  const result = await supabase
    .from('questions')
    .select(
      'id, user_id, subject, question_text, category, node, image_url, knowledge_point, ability, error_type, correct_answer, note, summary, mastery_level, confidence, next_review_date, stubborn_flag, mastery_state, mastered_at, is_archived, archived_at, created_at, review_count',
    )
    .eq('user_id', user.id)
    .eq('is_archived', false)
    .or(`next_review_date.is.null,next_review_date.lte.${nowIso}`)
    .order('next_review_date', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (result.error) {
    throw new Error(result.error.message);
  }

  return (result.data || []).map((item) => normalizeQuestionRow(item as Record<string, unknown>));
}

export async function getDueQuestionsCount(): Promise<number> {
  if (isLocalApiMode()) {
    try {
      const result = await localApiRequest<{ count: number }>('/questions/count?onlyDue=1&includeArchived=0');
      return Number(result?.count || 0);
    } catch (error) {
      if (String((error as Error)?.message || '').includes('请先登录')) {
        return 0;
      }
      throw error;
    }
  }
  if (!supabase) {
    return 0;
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    throw new Error(authError.message);
  }

  const user = authData.user;
  if (!user) {
    return 0;
  }

  const nowIso = new Date().toISOString();
  const result = await supabase
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('is_archived', false)
    .or(`next_review_date.is.null,next_review_date.lte.${nowIso}`);

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.count || 0;
}

export async function getQuestionBank(limit = 30): Promise<Question[]> {
  if (isLocalApiMode()) {
    try {
      const rows = await localApiRequest<Record<string, unknown>[]>(
        `/questions?limit=${Math.max(1, Math.min(limit, 100))}`,
      );
      return (rows || []).map((item) => normalizeQuestionRow(item));
    } catch (error) {
      if (String((error as Error)?.message || '').includes('请先登录')) {
        return [];
      }
      throw error;
    }
  }
  if (!supabase) {
    return [];
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    throw new Error(authError.message);
  }

  const user = authData.user;
  if (!user) {
    return [];
  }

  const result = await supabase
    .from('questions')
    .select(
      'id, user_id, subject, question_text, category, node, image_url, knowledge_point, ability, error_type, correct_answer, note, summary, mastery_level, confidence, next_review_date, stubborn_flag, mastery_state, mastered_at, is_archived, archived_at, created_at, review_count',
    )
    .eq('user_id', user.id)
    .eq('is_archived', false)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 100)));

  if (result.error) {
    throw new Error(result.error.message);
  }

  return (result.data || []).map((item) => normalizeQuestionRow(item as Record<string, unknown>));
}

export async function createQuestion(input: CreateQuestionInput): Promise<Question> {
  if (isLocalApiMode()) {
    const row = await localApiRequest<Record<string, unknown>>('/questions', {
      method: 'POST',
      body: JSON.stringify({
        subject: input.subject,
        question_text: input.questionText,
        category: input.category || null,
        node: input.node || null,
        image_url: input.imageUrl || null,
        knowledge_point: input.knowledgePoint || null,
        ability: input.ability || null,
        error_type: input.errorType || null,
        question_type: input.questionType || 'fill',
        correct_answer: input.correctAnswer || null,
        raw_ai_response: input.rawAiResponse || null,
        normalized_payload: input.normalizedPayload || null,
        payload_version: 'app_capture_v1',
        validation_status: 'draft',
        render_mode: 'plain',
        note: input.note || null,
        summary: input.summary || null,
        confidence: input.confidence ? Math.max(0, Math.min(100, Math.round(input.confidence))) : null,
        mastery_level: 0,
        next_review_date: null,
        stubborn_flag: false,
        review_count: 0,
      }),
    });
    return normalizeQuestionRow(row || {});
  }
  if (!supabase) {
    throw new Error('Supabase 未配置');
  }

  const rpc = await supabase.rpc('create_question', {
    p_subject: input.subject,
    p_question_text: input.questionText,
    p_category: input.category || null,
    p_node: input.node || null,
    p_image_url: input.imageUrl || null,
    p_knowledge_point: input.knowledgePoint || null,
    p_ability: input.ability || null,
    p_error_type: input.errorType || null,
    p_question_type: input.questionType || 'fill',
    p_correct_answer: input.correctAnswer || null,
    p_raw_ai_response: input.rawAiResponse || null,
    p_normalized_payload: input.normalizedPayload || null,
    p_payload_version: 'app_capture_v1',
    p_validation_status: 'draft',
    p_render_mode: 'plain',
    p_note: input.note || null,
    p_summary: input.summary || null,
    p_confidence: input.confidence ? Math.max(0, Math.min(100, Math.round(input.confidence))) : null,
    p_mastery_level: 0,
    p_next_review_date: null,
    p_stubborn_flag: false,
    p_review_count: 0,
  });
  if (rpc.error) {
    throw new Error(rpc.error.message);
  }
  const row = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) as Record<string, unknown> | null;
  if (!row) {
    throw new Error('创建题目失败');
  }
  return normalizeQuestionRow(row);
}
