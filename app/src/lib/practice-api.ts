import type { PracticeGeneratedQuestion, PracticeStrategy, PracticeSubject } from '@aiweb/mobile-shared';
import { isLocalApiMode } from './data-access';
import { env } from './env';
import { localApiRequest } from './local-data-api';
import { supabase } from './supabase';

export interface PracticeSessionSummary {
  id: string;
  subject: string;
  strategy: string;
  nodes: string[];
  planned_amount: number;
  generated_amount: number;
  correct_count: number;
  wrong_count: number;
  total_elapsed_seconds: number;
  status: string;
  created_at: string;
  completed_at?: string | null;
}

export interface PracticeAttemptSummary {
  id: string;
  session_id: string;
  question_index: number;
  question_text: string;
  question_type: string;
  correct_answer?: string | null;
  user_answer?: string | null;
  is_correct: boolean;
  knowledge_point?: string | null;
  duration_seconds: number;
  created_at: string;
}

export interface PracticeOverview {
  sessions: PracticeSessionSummary[];
  attempts: PracticeAttemptSummary[];
  totals: {
    sessionCount: number;
    activeCount: number;
    completedCount: number;
    correctCount: number;
    wrongCount: number;
  };
}

export interface PracticeGenerateInput {
  subject: PracticeSubject;
  strategy: PracticeStrategy;
  nodes: string[];
  amount: number;
}

export interface StartPracticeSessionInput {
  subject: PracticeSubject;
  strategy: PracticeStrategy;
  nodes: string[];
  planned_amount: number;
  generated_amount: number;
}

export interface SubmitPracticeAttemptInput {
  sessionId: string;
  questionIndex: number;
  question: PracticeGeneratedQuestion;
  userAnswer: string;
  subject: PracticeSubject;
  knowledgePoint?: string;
  ability?: string;
  errorType?: string;
  durationSeconds?: number;
  isFinal?: boolean;
}

export interface SubmitPracticeAttemptResult {
  attemptId: string;
  isCorrect: boolean;
  canonicalSubject: string;
  canonicalKnowledgePoint: string;
  canonicalAbility: string;
  canonicalErrorType: string;
  wrongSaved: boolean;
}

const PRACTICE_PROMPT_VERSION = 'app_targeted_drill_v1';
const PRACTICE_AI_ENDPOINT_SUFFIX = '/functions/v1/server/make-server-794e3fa7/chat/stream';

function createEmptyOverview(): PracticeOverview {
  return {
    sessions: [],
    attempts: [],
    totals: {
      sessionCount: 0,
      activeCount: 0,
      completedCount: 0,
      correctCount: 0,
      wrongCount: 0,
    },
  };
}

function toNodeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }
  return [];
}

function normalizeOptionText(value: unknown, index: number) {
  const label = String.fromCharCode(65 + index);
  const text = String(value ?? '')
    .trim()
    .replace(/^[A-H][\.．、:：\)）\]]\s*/i, '')
    .trim();
  if (!text) return '';
  return `${label}. ${text}`;
}

function parseGeneratedList(raw: string) {
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fencedMatch?.[1] || raw).trim();
  const arrayMatch = candidate.match(/\[[\s\S]*\]/);
  const jsonText = (arrayMatch?.[0] || candidate).trim();
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) {
    throw new Error('AI 返回格式错误');
  }
  return parsed;
}

function normalizeGeneratedQuestions(rawList: unknown[], amount: number): PracticeGeneratedQuestion[] {
  return rawList
    .map((entry, index) => {
      const item = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
      const rawOptions = Array.isArray(item.options) ? item.options : [];
      const options = rawOptions.map((value, optionIndex) => normalizeOptionText(value, optionIndex)).filter((value) => value.length > 0);
      const rawType = item.question_type === 'choice' || item.question_type === 'fill'
        ? item.question_type
        : item.questionType === 'choice' || item.questionType === 'fill'
          ? item.questionType
          : 'fill';
      const questionType = rawType === 'choice' && options.length < 2 ? 'fill' : rawType;
      const questionText = String(item.question_text || item.question || '').trim();
      return {
        level: Number(item.level) > 0 ? Number(item.level) : index + 1,
        question_type: questionType,
        question_text: questionText,
        options: questionType === 'choice' ? options : [],
        correct_answer: String(item.correct_answer || item.correctAnswer || '').trim(),
        acceptable_answers: Array.isArray(item.acceptable_answers)
          ? item.acceptable_answers.map((value) => String(value).trim()).filter(Boolean)
          : [],
        explanation: String(item.explanation || item.analysis || '暂无解析').trim(),
      } satisfies PracticeGeneratedQuestion;
    })
    .filter((item) => item.question_text.length > 0)
    .slice(0, Math.max(1, amount));
}

async function streamGenerateContent(prompt: string) {
  if (!supabase) {
    throw new Error('Supabase 未配置');
  }
  const baseUrl = String(env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('缺少 EXPO_PUBLIC_SUPABASE_URL');
  }
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new Error(error.message);
  }
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error('请先登录');
  }
  const response = await fetch(`${baseUrl}${PRACTICE_AI_ENDPOINT_SUFFIX}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      enable_thinking: false,
      systemPrompt: '你是一个专业出题AI。你必须只输出纯JSON数组，不要输出任何解释文本。',
    }),
  });
  if (!response.ok || !response.body) {
    const reason = await response.text();
    throw new Error(reason || 'AI 出题服务不可用');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
        const chunk = parsed.choices?.[0]?.delta?.content;
        if (chunk) {
          fullContent += chunk;
        }
      } catch {
      }
    }
  }
  return fullContent.trim();
}

export async function generatePracticeQuestions(input: PracticeGenerateInput): Promise<PracticeGeneratedQuestion[]> {
  const amount = Math.max(1, Math.min(20, Math.round(input.amount || 1)));
  const nodes = input.nodes.map((node) => node.trim()).filter(Boolean).slice(0, 8);
  if (nodes.length === 0) {
    throw new Error('请至少选择一个知识点');
  }
  const prompt = `请针对${input.subject}学科生成${amount}道专项练习题。知识点：${nodes.join('、')}。策略：${input.strategy}。返回严格JSON数组，不要任何markdown。\nJSON字段：level(1-5),question_type(choice或fill),question_text,options(仅choice),correct_answer,acceptable_answers(可选),explanation。`;
  const rawContent = await streamGenerateContent(prompt);
  if (!rawContent) {
    throw new Error('AI 未返回可用内容');
  }
  const list = parseGeneratedList(rawContent);
  const questions = normalizeGeneratedQuestions(list, amount);
  if (questions.length === 0) {
    throw new Error('未生成可用题目');
  }
  return questions;
}

export async function startPracticeSession(input: StartPracticeSessionInput) {
  if (isLocalApiMode()) {
    const data = await localApiRequest<{ id: string | null }>('/practice/sessions', {
      method: 'POST',
      body: JSON.stringify({
        subject: input.subject,
        strategy: input.strategy,
        nodes: input.nodes,
        planned_amount: input.planned_amount,
        generated_amount: input.generated_amount,
      }),
    });
    return {
      id: String(data?.id || ''),
      subject: input.subject,
      strategy: input.strategy,
      nodes: input.nodes,
      planned_amount: input.planned_amount,
      generated_amount: input.generated_amount,
      correct_count: 0,
      wrong_count: 0,
      total_elapsed_seconds: 0,
      status: 'active',
      created_at: new Date().toISOString(),
      completed_at: null,
    } satisfies PracticeSessionSummary;
  }
  if (!supabase) {
    throw new Error('Supabase 未配置');
  }
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    throw new Error(authError.message);
  }
  const user = authData.user;
  if (!user) {
    throw new Error('请先登录');
  }
  const result = await supabase
    .from('practice_sessions')
    .insert({
      user_id: user.id,
      subject: input.subject,
      strategy: input.strategy,
      nodes: input.nodes,
      planned_amount: input.planned_amount,
      generated_amount: input.generated_amount,
      status: 'active',
    })
    .select('id, subject, strategy, nodes, planned_amount, generated_amount, correct_count, wrong_count, total_elapsed_seconds, status, created_at, completed_at')
    .single();
  if (result.error) {
    throw new Error(result.error.message);
  }
  return {
    id: String(result.data.id),
    subject: String(result.data.subject || input.subject),
    strategy: String(result.data.strategy || input.strategy),
    nodes: toNodeList(result.data.nodes),
    planned_amount: Number(result.data.planned_amount || input.planned_amount),
    generated_amount: Number(result.data.generated_amount || input.generated_amount),
    correct_count: Number(result.data.correct_count || 0),
    wrong_count: Number(result.data.wrong_count || 0),
    total_elapsed_seconds: Number(result.data.total_elapsed_seconds || 0),
    status: String(result.data.status || 'active'),
    created_at: String(result.data.created_at || new Date().toISOString()),
    completed_at: typeof result.data.completed_at === 'string' ? result.data.completed_at : null,
  } satisfies PracticeSessionSummary;
}

export async function submitPracticeAttempt(input: SubmitPracticeAttemptInput): Promise<SubmitPracticeAttemptResult> {
  if (isLocalApiMode()) {
    const row = await localApiRequest<Record<string, unknown>>('/practice/attempts/submit', {
      method: 'POST',
      body: JSON.stringify({
        session_id: input.sessionId,
        question_index: input.questionIndex,
        question_text: input.question.question_text,
        question_type: input.question.question_type || (input.question.options.length > 1 ? 'choice' : 'fill'),
        correct_answer: input.question.correct_answer || '',
        user_answer: input.userAnswer,
        acceptable_answers: input.question.acceptable_answers || [],
        subject: input.subject,
        knowledge_point: input.knowledgePoint || '',
        ability: input.ability || null,
        error_type: input.errorType || null,
        duration_seconds: Math.max(0, Math.round(input.durationSeconds || 0)),
        source_node: input.knowledgePoint || null,
        ai_prompt_version: PRACTICE_PROMPT_VERSION,
        is_final: Boolean(input.isFinal),
      }),
    });
    return {
      attemptId: String(row?.attempt_id || ''),
      isCorrect: Boolean(row?.is_correct),
      canonicalSubject: String(row?.canonical_subject || input.subject),
      canonicalKnowledgePoint: String(row?.canonical_knowledge_point || input.knowledgePoint || ''),
      canonicalAbility: String(row?.canonical_ability || input.ability || ''),
      canonicalErrorType: String(row?.canonical_error_type || input.errorType || ''),
      wrongSaved: Boolean(row?.wrong_saved),
    };
  }
  if (!supabase) {
    throw new Error('Supabase 未配置');
  }
  const questionType = input.question.question_type || (input.question.options.length > 1 ? 'choice' : 'fill');
  const rpc = await supabase.rpc('submit_practice_attempt', {
    p_session_id: input.sessionId,
    p_question_index: input.questionIndex,
    p_question_text: input.question.question_text,
    p_question_type: questionType,
    p_correct_answer: input.question.correct_answer || '',
    p_user_answer: input.userAnswer,
    p_acceptable_answers: input.question.acceptable_answers || [],
    p_subject: input.subject,
    p_knowledge_point: input.knowledgePoint || null,
    p_ability: input.ability || null,
    p_error_type: input.errorType || null,
    p_duration_seconds: Math.max(0, Math.round(input.durationSeconds || 0)),
    p_source_node: input.knowledgePoint || null,
    p_ai_prompt_version: PRACTICE_PROMPT_VERSION,
    p_is_final: Boolean(input.isFinal),
  });
  if (rpc.error) {
    throw new Error(rpc.error.message);
  }
  const row = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) || {};
  return {
    attemptId: String(row.attempt_id || ''),
    isCorrect: Boolean(row.is_correct),
    canonicalSubject: String(row.canonical_subject || input.subject),
    canonicalKnowledgePoint: String(row.canonical_knowledge_point || input.knowledgePoint || ''),
    canonicalAbility: String(row.canonical_ability || input.ability || ''),
    canonicalErrorType: String(row.canonical_error_type || input.errorType || ''),
    wrongSaved: Boolean(row.wrong_saved),
  };
}

export async function getPracticeOverview(sessionLimit = 5, attemptLimit = 10): Promise<PracticeOverview> {
  if (isLocalApiMode()) {
    try {
      const data = await localApiRequest<PracticeOverview>(
        `/practice/overview?sessionLimit=${Math.max(1, Math.min(sessionLimit, 20))}&attemptLimit=${Math.max(1, Math.min(attemptLimit, 30))}`,
      );
      return data || createEmptyOverview();
    } catch (error) {
      if (String((error as Error)?.message || '').includes('请先登录')) {
        return createEmptyOverview();
      }
      throw error;
    }
  }
  if (!supabase) {
    return createEmptyOverview();
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    throw new Error(authError.message);
  }

  const user = authData.user;
  if (!user) {
    return createEmptyOverview();
  }

  const [sessionsResult, attemptsResult] = await Promise.all([
    supabase
      .from('practice_sessions')
      .select('id, subject, strategy, nodes, planned_amount, generated_amount, correct_count, wrong_count, total_elapsed_seconds, status, created_at, completed_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(sessionLimit, 20))),
    supabase
      .from('practice_attempts')
      .select('id, session_id, question_index, question_text, question_type, correct_answer, user_answer, is_correct, knowledge_point, duration_seconds, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(attemptLimit, 30))),
  ]);

  if (sessionsResult.error) {
    throw new Error(sessionsResult.error.message);
  }
  if (attemptsResult.error) {
    throw new Error(attemptsResult.error.message);
  }

  const sessions = (sessionsResult.data || []).map((item) => ({
    id: String(item.id),
    subject: String(item.subject || '未知'),
    strategy: String(item.strategy || '未设置'),
    nodes: toNodeList(item.nodes),
    planned_amount: Number(item.planned_amount || 0),
    generated_amount: Number(item.generated_amount || 0),
    correct_count: Number(item.correct_count || 0),
    wrong_count: Number(item.wrong_count || 0),
    total_elapsed_seconds: Number(item.total_elapsed_seconds || 0),
    status: String(item.status || 'active'),
    created_at: String(item.created_at || new Date(0).toISOString()),
    completed_at: typeof item.completed_at === 'string' ? item.completed_at : null,
  }));

  const attempts = (attemptsResult.data || []).map((item) => ({
    id: String(item.id),
    session_id: String(item.session_id),
    question_index: Number(item.question_index || 0),
    question_text: String(item.question_text || ''),
    question_type: String(item.question_type || 'unknown'),
    correct_answer: typeof item.correct_answer === 'string' ? item.correct_answer : null,
    user_answer: typeof item.user_answer === 'string' ? item.user_answer : null,
    is_correct: Boolean(item.is_correct),
    knowledge_point: typeof item.knowledge_point === 'string' ? item.knowledge_point : null,
    duration_seconds: Number(item.duration_seconds || 0),
    created_at: String(item.created_at || new Date(0).toISOString()),
  }));

  return {
    sessions,
    attempts,
    totals: {
      sessionCount: sessions.length,
      activeCount: sessions.filter((item) => item.status === 'active').length,
      completedCount: sessions.filter((item) => item.status === 'completed').length,
      correctCount: attempts.filter((item) => item.is_correct).length,
      wrongCount: attempts.filter((item) => !item.is_correct).length,
    },
  };
}
