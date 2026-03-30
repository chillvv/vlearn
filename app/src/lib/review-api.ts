import type { Question } from '@aiweb/mobile-shared';
import { isLocalApiMode } from './data-access';
import { localApiRequest } from './local-data-api';
import { normalizeQuestionRow } from './questions-api';
import { supabase } from './supabase';

export type ReviewRating = 'forgot' | 'vague' | 'mastered';

export interface ReviewAttemptRecord {
  id: string;
  question_id: string;
  user_answer?: string;
  selected_option_text?: string;
  correct_answer?: string;
  is_correct: boolean;
  rating: ReviewRating;
  ai_diagnosis?: Record<string, unknown> | null;
  next_review_date?: string;
  created_at: string;
}

export interface SubmitReviewAttemptInput {
  questionId: string;
  questionText: string;
  questionType?: string;
  rating: ReviewRating;
  correctAnswer?: string;
  knowledgePoint?: string;
}

export interface SubmitReviewAttemptResult {
  attemptId?: string;
  question: Question;
  nextReviewDate?: string;
}

export async function getRecentReviewAttempts(questionId: string, limit = 6): Promise<ReviewAttemptRecord[]> {
  if (isLocalApiMode()) {
    if (!questionId) return [];
    try {
      const rows = await localApiRequest<ReviewAttemptRecord[]>(
        `/review/recent-attempts?questionId=${encodeURIComponent(questionId)}&limit=${Math.max(1, Math.min(limit, 20))}`,
      );
      return rows || [];
    } catch (error) {
      if (String((error as Error)?.message || '').includes('请先登录')) {
        return [];
      }
      throw error;
    }
  }
  if (!supabase || !questionId) {
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
    .from('question_review_attempts')
    .select('id, question_id, user_answer, selected_option_text, correct_answer, is_correct, rating, ai_diagnosis, next_review_date, created_at')
    .eq('user_id', user.id)
    .eq('question_id', questionId)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 20)));

  if (result.error) {
    throw new Error(result.error.message);
  }

  return (result.data || []) as ReviewAttemptRecord[];
}

export async function submitReviewAttempt(input: SubmitReviewAttemptInput): Promise<SubmitReviewAttemptResult> {
  if (isLocalApiMode()) {
    const payload = await localApiRequest<{
      attempt_id?: string | null;
      next_review_date?: string;
      question: Record<string, unknown>;
    }>('/review/attempt', {
      method: 'POST',
      body: JSON.stringify({
        questionId: input.questionId,
        userAnswer: '',
        isCorrect: input.rating !== 'forgot',
        rating: input.rating,
        correctAnswer: input.correctAnswer || null,
        selectedOptionText: null,
        diagnosis: {
          source: 'mobile-app',
          mode: 'self-rating',
          question_type: input.questionType || 'review',
          why_wrong: input.rating === 'forgot' ? '用户在移动端标记为完全遗忘。' : '用户在移动端完成复习并进行了自评。',
          evidence: input.questionText,
          fix_strategy: input.knowledgePoint ? `继续围绕 ${input.knowledgePoint} 做巩固练习。` : '继续完成后续复习题保持记忆曲线。',
          next_practice_type: input.rating === 'mastered' ? '延后复习' : '继续复习',
        },
      }),
    });
    return {
      attemptId: typeof payload?.attempt_id === 'string' ? payload.attempt_id : undefined,
      question: normalizeQuestionRow(payload?.question || {}),
      nextReviewDate: payload?.next_review_date,
    };
  }
  if (!supabase) {
    throw new Error('未配置 Supabase，无法提交复习结果');
  }

  const rpc = await supabase.rpc('submit_review_attempt', {
    p_question_id: input.questionId,
    p_user_answer: '',
    p_is_correct: input.rating !== 'forgot',
    p_rating: input.rating,
    p_correct_answer: input.correctAnswer || null,
    p_selected_option_text: null,
    p_ai_diagnosis: {
      source: 'mobile-app',
      mode: 'self-rating',
      question_type: input.questionType || 'review',
      why_wrong: input.rating === 'forgot' ? '用户在移动端标记为完全遗忘。' : '用户在移动端完成复习并进行了自评。',
      evidence: input.questionText,
      fix_strategy: input.knowledgePoint ? `继续围绕 ${input.knowledgePoint} 做巩固练习。` : '继续完成后续复习题保持记忆曲线。',
      next_practice_type: input.rating === 'mastered' ? '延后复习' : '继续复习',
    },
  });

  if (rpc.error) {
    throw new Error(rpc.error.message);
  }

  const rpcRow = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
  const refetch = await supabase.from('questions').select('*').eq('id', input.questionId).single();
  if (refetch.error || !refetch.data) {
    throw new Error(refetch.error?.message || '复习提交成功，但读取题目快照失败');
  }

  return {
    attemptId: typeof rpcRow?.attempt_id === 'string' ? rpcRow.attempt_id : undefined,
    question: normalizeQuestionRow(refetch.data as Record<string, unknown>),
    nextReviewDate: typeof rpcRow?.next_review_date === 'string' ? rpcRow.next_review_date : refetch.data.next_review_date,
  };
}
