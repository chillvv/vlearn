import type {
  GovernedGenerationRequest,
  GovernedGenerationResult,
  LearningContentState,
  LearningTelemetryEventInput,
  LearningWritebackContext,
  NodeDossier,
  NodeDossierFileExport,
  NodeDossierQuery,
  NodeDossierSortMetric,
  NodeDossierSortStrategy,
  NodeMistakeIndexEntry,
  NodeMistakeLookupQuery,
  PlanTelemetry,
  PlannerInputPayload,
  PlannerOutputPayload,
  PlannerQueueItem,
  Question,
  QuestionQuery,
  ReviewAttemptRecord,
  ReviewPlannerRunInput,
  ReviewPlannerRunResult,
  SubmitReviewAttemptInput,
  SubmitReviewAttemptResult,
  Stats,
  Subject,
  TagExtensions,
  TaxonomyOverrideMap,
  UserLearningStateRecord,
  UserWeakness,
  VariantQuestion,
} from './types';
import { applyRuntimeTagDictionary, getKnowledgePointsBySubject } from './types';
import {
  attachCanonicalKnowledgeNodeIds,
  attachCanonicalKnowledgePointIds,
  attachCanonicalQuestionIds,
  matchesQuestionIdentifier,
  resolveCanonicalMistakeId,
  resolveCanonicalNodeId,
  resolveCanonicalTagId,
} from './entityIds';
import { formatQuestionTextForStorage } from './questionPreview';
import {
  buildNormalizedQuestionPayload,
  deriveRenderMode,
  getStemFromPayload,
  normalizeValidationStatus,
  parseStoredNormalizedPayload,
  validateNormalizedQuestionPayload,
} from './questionPayload';
import { setLearningSyncSnapshot } from './learningSyncStatus';
import { normalizeQuestionTags } from './questionTagEngine';
import { persistentCacheAdapter } from './cacheAdapter';
import { queryClient } from './queryClient';
import { queryKeys } from './queryKeys';
import {
  dataAccessMode,
  reviewAiGrayPercent,
  reviewAiPlannerEnabled,
} from './config';
import { localDataApiFetch } from './localDataApi';
import {
  buildReviewPlannerGraySeed,
  buildReviewPlannerPlanVersion,
  getReviewPlannerStrategyMeta,
  resolveReviewPlannerRollout,
} from './reviewPlannerStrategy';

const LOCAL_DEV_USER_ID = '359ed1b4-913b-41a2-8d9f-f597d0f2084c';
const LOCAL_DEV_USER_EMAIL = '1300968688@qq.com';
const LOCAL_AUTH_SESSION_KEY = 'vlearn_local_auth_session';
const LOCAL_TOKEN_PREFIX = 'local-user:';
const LEGACY_LOCAL_FALLBACK_ACCESS_TOKEN = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJsb2NhbC1kZXYtdXNlciIsImVtYWlsIjoibG9jYWxAZXhhbXBsZS5jb20iLCJleHAiOjQxMDI0NDQ4MDB9.local';

type LocalAuthUser = {
  id: string;
  email: string;
  aud: 'authenticated';
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  created_at: string;
};

type LocalAuthSession = {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  expires_at: number;
  refresh_token: string;
  user: LocalAuthUser;
};

type LocalAuthStateListener = (_event: string, session: LocalAuthSession) => void;

function buildLocalAuthUser(name?: string | null): LocalAuthUser {
  return {
    id: LOCAL_DEV_USER_ID,
    email: LOCAL_DEV_USER_EMAIL,
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: name ? { name: String(name).trim() } : {},
    created_at: new Date(0).toISOString(),
  };
}

function buildLocalAuthSession(user: LocalAuthUser = buildLocalAuthUser()): LocalAuthSession {
  const expiresIn = 60 * 60 * 24 * 365;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    access_token: LEGACY_LOCAL_FALLBACK_ACCESS_TOKEN,
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: nowSeconds + expiresIn,
    refresh_token: '',
    user,
  };
}

const localAuthListeners = new Set<LocalAuthStateListener>();
const singletonLocalSession = buildLocalAuthSession();

function readLocalAuthSession(): LocalAuthSession {
  if (typeof window === 'undefined') return singletonLocalSession;
  const raw = window.localStorage.getItem(LOCAL_AUTH_SESSION_KEY);
  if (!raw) return singletonLocalSession;
  try {
    const parsed = JSON.parse(raw) as LocalAuthSession;
    if (!parsed?.user?.id || !parsed?.access_token) return singletonLocalSession;
    const needsNormalizeToken = parsed.access_token !== LEGACY_LOCAL_FALLBACK_ACCESS_TOKEN;
    const needsNormalizeUser = parsed.user.id !== LOCAL_DEV_USER_ID;
    if (!needsNormalizeToken && !needsNormalizeUser) return parsed;
    const normalizedSession = buildLocalAuthSession(buildLocalAuthUser(parsed.user?.user_metadata?.name as string | undefined));
    writeLocalAuthSession(normalizedSession);
    return normalizedSession;
  } catch {
    return singletonLocalSession;
  }
}

function writeLocalAuthSession(session: LocalAuthSession) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LOCAL_AUTH_SESSION_KEY, JSON.stringify(session));
}

function emitLocalAuthState(event: string, session: LocalAuthSession) {
  localAuthListeners.forEach((listener) => {
    listener(event, session);
  });
}

function parseUserIdFromToken(token: string) {
  const raw = String(token || '').trim();
  if (raw === LEGACY_LOCAL_FALLBACK_ACCESS_TOKEN) return LOCAL_DEV_USER_ID;
  if (!raw.startsWith(LOCAL_TOKEN_PREFIX)) return '';
  return decodeURIComponent(raw.slice(LOCAL_TOKEN_PREFIX.length));
}

type SupabaseClientType = {
  auth: {
    getSession: () => Promise<{ data: { session: LocalAuthSession | null }; error: null }>;
    getUser: (jwt?: string) => Promise<{ data: { user: LocalAuthUser | null }; error: null }>;
    signUp: (input: { email: string; password: string; options?: { data?: Record<string, unknown> } }) => Promise<{ data: { user: LocalAuthUser; session: LocalAuthSession }; error: null }>;
    signInWithPassword: (input: { email: string; password: string }) => Promise<{ data: { user: LocalAuthUser; session: LocalAuthSession }; error: null }>;
    signOut: () => Promise<{ error: null }>;
    updateUser: (input: Record<string, unknown>) => Promise<{ data: { user: LocalAuthUser | null }; error: null }>;
    onAuthStateChange: (listener: LocalAuthStateListener) => { data: { subscription: { unsubscribe: () => void } } };
  };
  from: (table: string) => any;
  rpc: (fn: string, params?: Record<string, unknown>) => Promise<any>;
};

function unsupportedSupabaseCall(name: string): never {
  throw new Error(`当前仅支持 local_api 模式，禁止 Supabase 调用: ${name}`);
}

export const supabase: SupabaseClientType = {
  auth: {
    getSession: async () => ({ data: { session: readLocalAuthSession() }, error: null }),
    getUser: async (jwt?: string) => {
      if (jwt) {
        const userId = parseUserIdFromToken(jwt);
        if (userId) {
          return { data: { user: buildLocalAuthUser() }, error: null };
        }
      }
      const session = readLocalAuthSession();
      return { data: { user: session.user }, error: null };
    },
    signUp: async ({ options }) => {
      const user = buildLocalAuthUser(String(options?.data?.name || '').trim() || null);
      const session = buildLocalAuthSession(user);
      writeLocalAuthSession(session);
      emitLocalAuthState('SIGNED_IN', session);
      return { data: { user, session }, error: null };
    },
    signInWithPassword: async () => {
      const user = buildLocalAuthUser();
      const session = buildLocalAuthSession(user);
      writeLocalAuthSession(session);
      emitLocalAuthState('SIGNED_IN', session);
      return { data: { user, session }, error: null };
    },
    signOut: async () => {
      const session = readLocalAuthSession();
      emitLocalAuthState('SIGNED_IN', session);
      return { error: null };
    },
    updateUser: async () => {
      const session = readLocalAuthSession();
      return { data: { user: session.user }, error: null };
    },
    onAuthStateChange: (listener: LocalAuthStateListener) => {
      localAuthListeners.add(listener);
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              localAuthListeners.delete(listener);
            },
          },
        },
      };
    },
  },
  from: () => unsupportedSupabaseCall('from'),
  rpc: async () => unsupportedSupabaseCall('rpc'),
};

const LOCAL_DEV_FALLBACK_ACCESS_TOKEN = LEGACY_LOCAL_FALLBACK_ACCESS_TOKEN;

const DEFAULT_AI_PROXY_URL = `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`;

function getAiProxyUrl() {
  const env = (import.meta as any).env || {};
  return env.VITE_AI_PROXY_URL || env.NEXT_PUBLIC_AI_PROXY_URL || DEFAULT_AI_PROXY_URL;
}

const AI_MAX_CONCURRENT_REQUESTS = 3;
const AI_CHAT_DUPLICATE_WINDOW_MS = 1500;
const AI_GUARD_FAILURE_THRESHOLD = 3;
const AI_GUARD_COOLDOWN_MS = 60_000;
const AI_GUARD_INFLIGHT_STALE_MS = 180_000;
const AI_STREAM_TIMEOUT_MS = 120_000;
const AI_STREAM_MAX_CONTENT_CHARS = 18_000;
const AI_STREAM_MAX_REASONING_CHARS = 24_000;

type AiGuardState = {
  lastStartAt: number;
  consecutiveFailures: number;
  cooldownUntil: number;
};

type AiInFlightState = {
  startedAt: number;
};

const aiGuardStateByKey = new Map<string, AiGuardState>();
const aiInFlightByKey = new Map<string, AiInFlightState>();
let aiGlobalInFlightCount = 0;

function trimGuardText(value: unknown, maxLength = 200) {
  const raw = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (raw.length <= maxLength) return raw;
  return raw.slice(0, maxLength);
}

function stringifyGuardContent(content: any) {
  if (typeof content === 'string') return trimGuardText(content, 260);
  if (Array.isArray(content)) {
    return trimGuardText(content.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object' && typeof item.type === 'string') {
        if (item.type === 'text') return String(item.text || '');
        if (item.type === 'image_url') return '[image]';
      }
      return JSON.stringify(item);
    }).join(' | '), 260);
  }
  return trimGuardText(JSON.stringify(content), 260);
}

function pruneAiGuardState(now = Date.now()) {
  const staleKeys: string[] = [];
  aiInFlightByKey.forEach((entry, key) => {
    if (now - entry.startedAt > AI_GUARD_INFLIGHT_STALE_MS) {
      staleKeys.push(key);
    }
  });
  if (staleKeys.length > 0) {
    staleKeys.forEach((key) => {
      if (aiInFlightByKey.delete(key)) {
        aiGlobalInFlightCount = Math.max(0, aiGlobalInFlightCount - 1);
      }
    });
  }
}

function acquireAiRequestGuard(input: {
  key: string;
  duplicateWindowMs?: number;
}) {
  const now = Date.now();
  pruneAiGuardState(now);
  const state = aiGuardStateByKey.get(input.key) || {
    lastStartAt: 0,
    consecutiveFailures: 0,
    cooldownUntil: 0,
  };
  if (state.cooldownUntil > now) {
    const seconds = Math.max(1, Math.ceil((state.cooldownUntil - now) / 1000));
    throw new Error(`ai_guard_cooldown_${seconds}`);
  }
  if (aiInFlightByKey.has(input.key)) {
    throw new Error('ai_guard_inflight_duplicate');
  }
  if (aiGlobalInFlightCount >= AI_MAX_CONCURRENT_REQUESTS) {
    throw new Error('ai_guard_global_busy');
  }
  if ((input.duplicateWindowMs || 0) > 0 && now - state.lastStartAt < (input.duplicateWindowMs || 0)) {
    throw new Error('ai_guard_too_frequent');
  }
  state.lastStartAt = now;
  aiGuardStateByKey.set(input.key, state);
  aiInFlightByKey.set(input.key, { startedAt: now });
  aiGlobalInFlightCount += 1;
  let released = false;
  return {
    release: (outcome: 'success' | 'failed') => {
      if (released) return;
      released = true;
      if (aiInFlightByKey.delete(input.key)) {
        aiGlobalInFlightCount = Math.max(0, aiGlobalInFlightCount - 1);
      }
      const current = aiGuardStateByKey.get(input.key) || state;
      if (outcome === 'success') {
        current.consecutiveFailures = 0;
      } else {
        current.consecutiveFailures += 1;
        if (current.consecutiveFailures >= AI_GUARD_FAILURE_THRESHOLD) {
          current.cooldownUntil = Date.now() + AI_GUARD_COOLDOWN_MS;
          current.consecutiveFailures = 0;
        }
      }
      aiGuardStateByKey.set(input.key, current);
    },
  };
}

function mapAiGuardErrorMessage(err: unknown) {
  const message = String((err as any)?.message || '');
  if (message.startsWith('ai_guard_cooldown_')) {
    const seconds = Number(message.replace('ai_guard_cooldown_', '')) || 60;
    return `AI 调用已进入冷却保护，请 ${seconds} 秒后重试`;
  }
  if (message === 'ai_guard_inflight_duplicate') {
    return '检测到同一请求仍在处理中，已自动拦截重复调用';
  }
  if (message === 'ai_guard_global_busy') {
    return '当前并发请求过多，已触发保护，请稍后重试';
  }
  if (message === 'ai_guard_too_frequent') {
    return '触发过于频繁，已触发防抖保护，请稍后再试';
  }
  if (message === 'ai_guard_content_too_long') {
    return 'AI 输出过长，已自动中止以防止异常消耗';
  }
  if (message === 'ai_guard_reasoning_too_long') {
    return 'AI 深度思考输出过长，已自动中止以防止异常消耗';
  }
  return message;
}

function buildChatGuardKey(input: {
  model?: string;
  systemPrompt?: string;
  enableThinking?: boolean;
  messages: { role: string; content: any }[];
}) {
  const normalizedMessages = Array.isArray(input.messages) ? input.messages : [];
  const lastUserMessage = [...normalizedMessages].reverse().find((item) => item?.role === 'user');
  const roleSummary = normalizedMessages.slice(-4).map((item) => item?.role || 'unknown').join(',');
  return [
    trimGuardText(input.model || '', 80),
    input.enableThinking ? 'thinking' : 'normal',
    trimGuardText(input.systemPrompt || '', 120),
    roleSummary,
    stringifyGuardContent(lastUserMessage?.content || ''),
  ].join('|');
}

function buildPlannerGuardKey(payload: PlannerInputPayload, strategyTemplate: string) {
  const queueIds = (payload.questions || []).slice(0, 24).map((item) => String(item.question_id || '').trim()).join(',');
  return [
    'planner',
    strategyTemplate,
    (payload.session_constraints.subjects || []).join(','),
    String(payload.session_constraints.budget_count || 0),
    queueIds,
  ].join('|');
}

function isLocalDataApiMode() {
  return dataAccessMode === 'local_api';
}

async function getAccessToken() {
  const sessionResult = await supabase.auth.getSession();
  const token = sessionResult.data.session?.access_token;
  if (!token) {
    if (isLocalDataApiMode()) return LOCAL_DEV_FALLBACK_ACCESS_TOKEN;
    throw new Error('未登录');
  }
  return token;
}

async function getAccessTokenOrLocalFallback() {
  return getAccessToken().catch(() => LOCAL_DEV_FALLBACK_ACCESS_TOKEN);
}

function normalizeQuestionRow(row: any): Question {
  const canonicalRow = attachCanonicalQuestionIds(row || {});
  const questionText = row?.question_text || row?.question || '未填写题目内容';
  const fallbackPayload = buildNormalizedQuestionPayload({
    questionText,
    optionsInput: Array.isArray(row?.options) ? row.options : [],
    questionTypeHint: row?.question_type,
    correctAnswer: row?.correct_answer,
    explanation: row?.note,
  });
  const normalizedPayload = parseStoredNormalizedPayload(row?.normalized_payload) || fallbackPayload;
  const validation = validateNormalizedQuestionPayload(normalizedPayload);
  const validationStatus = row?.validation_status || normalizeValidationStatus(validation.valid);
  const renderMode = row?.render_mode || deriveRenderMode(validationStatus);
  const canonicalTags = normalizeQuestionTags({
    subject: canonicalRow?.subject,
    knowledgePoint: canonicalRow?.knowledge_point,
  });
  return {
    ...canonicalRow,
    subject: canonicalTags.subject,
    question_text: questionText,
    knowledge_point: canonicalTags.knowledgePoint,
    ability: '',
    question_type: row?.question_type || normalizedPayload.questionType,
    normalized_payload: normalizedPayload,
    validation_status: validationStatus,
    render_mode: renderMode,
    error_type: '',
    payload_version: row?.payload_version || normalizedPayload.version,
    mastery_level: row?.mastery_level ?? Math.round((row?.confidence ?? 0.5) * 100),
    stability: row?.stability == null ? undefined : Number(row.stability),
    difficulty: row?.difficulty == null ? undefined : Number(row.difficulty),
    last_interval_days: row?.last_interval_days == null ? undefined : Number(row.last_interval_days),
    lapse_count: row?.lapse_count == null ? undefined : Number(row.lapse_count),
    predicted_recall: row?.predicted_recall == null ? undefined : Number(row.predicted_recall),
    priority_score: row?.priority_score == null ? undefined : Number(row.priority_score),
    plan_source: row?.plan_source || 'rule_fallback',
  } as Question;
}

function normalizeKnowledgeNodeRow(row: any) {
  return attachCanonicalKnowledgeNodeIds(row || {});
}

function normalizeKnowledgePointRow(row: any) {
  return attachCanonicalKnowledgePointIds(row || {});
}

function normalizeTaxonomyWriteResult(payload: any) {
  if (!payload || typeof payload !== 'object') return payload;
  const knowledgePoint = payload.knowledge_point ? normalizeKnowledgePointRow(payload.knowledge_point) : payload.knowledge_point;
  const nodeSeed = payload.node && typeof payload.node === 'object' ? payload.node : {};
  return {
    ...payload,
    knowledge_point: knowledgePoint,
    node: normalizeKnowledgeNodeRow({
      ...nodeSeed,
      tag_id: (nodeSeed as any)?.tag_id || knowledgePoint?.tag_id || payload?.tag?.tag_id,
      node_id: (nodeSeed as any)?.node_id || knowledgePoint?.node_id || knowledgePoint?.kp_id,
      knowledge_point_id: (nodeSeed as any)?.knowledge_point_id || knowledgePoint?.kp_id,
      name: (nodeSeed as any)?.name || (nodeSeed as any)?.node || knowledgePoint?.name,
    }),
  };
}

async function resolveStoredQuestionRowId(identifier: string): Promise<string> {
  const normalized = String(identifier || '').trim();
  if (!normalized) return '';
  const allQuestions = await questionsApi.getAll();
  const matched = allQuestions.find((question) => matchesQuestionIdentifier(question, normalized));
  return matched?.id || normalized;
}

function isQuestionArchived(item: Partial<Question> | null | undefined) {
  return Boolean(item?.is_archived || item?.mastery_state === 'archived');
}

const VALID_MASTERY_STATES: NonNullable<Question['mastery_state']>[] = ['active', 'mastered', 'archived'];
let dictionaryHydrateInFlight: Promise<void> | null = null;

function normalizeMasteryStateForInsert(state: Question['mastery_state'] | null | undefined): NonNullable<Question['mastery_state']> {
  return VALID_MASTERY_STATES.includes(state as NonNullable<Question['mastery_state']>) ? (state as NonNullable<Question['mastery_state']>) : 'active';
}

function ensureNonEmptyTagDictionary() {
  applyRuntimeTagDictionary({
    knowledgePointBySubject: {
      英语: getKnowledgePointsBySubject('英语'),
      C语言: getKnowledgePointsBySubject('C语言'),
    },
    errorTypeBySubject: {
      英语: [],
      C语言: [],
    },
    abilities: [],
  });
}

function hydrateTagDictionaryFromPayload(payload: any) {
  const bySubject = payload?.dictionary?.by_subject || {};
  const knowledge = bySubject?.knowledge_point || {};
  applyRuntimeTagDictionary({
    knowledgePointBySubject: {
      英语: Array.isArray(knowledge?.英语) ? knowledge.英语 : [],
      C语言: Array.isArray(knowledge?.C语言) ? knowledge.C语言 : [],
    },
    errorTypeBySubject: {
      英语: [],
      C语言: [],
    },
    abilities: [],
  });
  ensureNonEmptyTagDictionary();
}

async function hydrateTagDictionaryOnce(force = false) {
  if (!force && getKnowledgePointsBySubject('英语').length > 0 && getKnowledgePointsBySubject('C语言').length > 0) {
    return;
  }
  if (!dictionaryHydrateInFlight) {
    dictionaryHydrateInFlight = (async () => {
      try {
        if (isLocalDataApiMode()) {
          const token = await getAccessToken();
          const response = await localDataApiFetch<{ data: any }>(token, '/tag-dictionary');
          hydrateTagDictionaryFromPayload(response.data || {});
          return;
        }
        const [catalogResult, itemsResult] = await Promise.all([
          supabase.from('tag_catalog').select('tag_id,subject,tag_name,category,branch,code').order('tag_id', { ascending: true }),
          supabase.from('tag_dictionary_items').select('item_type,subject,label,sort_order').order('sort_order', { ascending: true }),
        ]);
        if (catalogResult.error || itemsResult.error) {
          throw new Error(catalogResult.error?.message || itemsResult.error?.message || '标签字典读取失败');
        }
        const grouped: Record<string, Record<string, string[]>> = {
          knowledge_point: {},
          error_type: {},
          ability: {},
        };
        const all: Record<string, string[]> = {
          knowledge_point: [],
          error_type: [],
          ability: [],
        };
        for (const row of itemsResult.data || []) {
          const type = String(row.item_type || '').trim();
          if (!(type in grouped)) continue;
          const label = String(row.label || '').trim();
          if (!label) continue;
          const subject = String(row.subject || '').trim();
          all[type].push(label);
          if (subject) {
            if (!grouped[type][subject]) grouped[type][subject] = [];
            grouped[type][subject].push(label);
          }
        }
        hydrateTagDictionaryFromPayload({
          tags: catalogResult.data || [],
          dictionary: {
            by_subject: grouped,
            all,
          },
        });
      } catch {
        ensureNonEmptyTagDictionary();
      }
    })().finally(() => {
      dictionaryHydrateInFlight = null;
    });
  }
  await dictionaryHydrateInFlight;
}

function sanitizeMasteryStateForUpdate(payload: Partial<Question>): Partial<Question> {
  if (!Object.prototype.hasOwnProperty.call(payload, 'mastery_state')) {
    return payload;
  }
  const state = payload.mastery_state;
  if (VALID_MASTERY_STATES.includes(state as NonNullable<Question['mastery_state']>)) {
    return payload;
  }
  const next = { ...payload };
  delete next.mastery_state;
  return next;
}

function normalizeQuestionPayload(payload: Partial<Question> & { options?: string[] }) {
  const normalizedPayload = payload.normalized_payload || buildNormalizedQuestionPayload({
    questionText: payload.question_text || '',
    optionsInput: payload.options || [],
    questionTypeHint: payload.question_type,
    correctAnswer: payload.correct_answer,
    explanation: payload.note,
  });
  const validation = validateNormalizedQuestionPayload(normalizedPayload);
  const stem = getStemFromPayload(normalizedPayload);
  const canonicalTags = normalizeQuestionTags({
    subject: payload.subject,
    knowledgePoint: payload.knowledge_point,
  });
  const questionText = formatQuestionTextForStorage(
    stem,
    normalizedPayload.questionType === 'choice'
      ? normalizedPayload.options.map((item) => `${item.label}. ${item.text}`)
      : [],
  );
  const validationStatus = normalizeValidationStatus(validation.valid);
  return {
    ...payload,
    subject: canonicalTags.subject,
    question_text: questionText,
    knowledge_point: canonicalTags.knowledgePoint,
    ability: '',
    question_type: normalizedPayload.questionType,
    raw_ai_response: payload.raw_ai_response || payload.question_text || questionText,
    normalized_payload: normalizedPayload,
    payload_version: normalizedPayload.version,
    validation_status: validationStatus,
    render_mode: deriveRenderMode(validationStatus),
    error_type: '',
  };
}

const REVIEW_PLANNER_TIMEOUT_MS = 5000;
const REVIEW_PLANNER_MAX_RETRIES = 2;
const REVIEW_PLANNER_STRATEGIES = ['rescue', 'reinforce', 'new', 'revisit'] as const;

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function hashTextToBucket(input: string) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash % 100);
}

function buildPlannerInputPayload(userId: string, input: ReviewPlannerRunInput): PlannerInputPayload {
  return {
    request_id: crypto.randomUUID(),
    request_at: new Date().toISOString(),
    user: {
      user_id: userId,
      stats_7d: { review_count: 0, accuracy: 0, interruption_rate: 0 },
      stats_30d: { review_count: 0, accuracy: 0, interruption_rate: 0 },
      subject_preference: [input.subject],
    },
    session_constraints: {
      budget_count: Math.max(1, input.budget_count),
      prefer_due: input.scope === 'due',
      subjects: [input.subject],
    },
    system_constraints: {
      min_interval_days: 1,
      max_session_count: 5,
      due_min_ratio: input.due_min_ratio,
      archived_excluded: true,
    },
    questions: input.rule_queue.map((question) => ({
      question_id: question.id,
      subject: question.subject as Subject,
      knowledge_point: question.knowledge_point,
      mastery_state: question.mastery_state || 'active',
      review_count: question.review_count || 0,
      last_result: 'unknown',
      last_interval_days: question.last_interval_days || 0,
      lapse_count: question.lapse_count || 0,
      stability: question.stability || 0,
      difficulty: question.difficulty || 0.5,
      predicted_recall: question.predicted_recall || 0,
      is_due: !!question.next_review_date && new Date(question.next_review_date) <= new Date(),
      is_archived: !!question.is_archived,
    })),
  };
}

function buildRuleQueueSnapshot(queue: Question[]): PlannerQueueItem[] {
  return queue.map((item, index) => ({
    question_id: item.id,
    rank: index + 1,
    reason: item.plan_source === 'ai' ? 'AI 计划' : '规则候选顺序',
    suggested_interval_days: Math.max(1, Math.round(item.last_interval_days || 1)),
    priority_score: clampNumber(item.priority_score, Math.max(1, 100 - index), 0, 100),
    strategy: item.next_review_date && new Date(item.next_review_date) <= new Date() ? 'rescue' : 'reinforce',
  }));
}

function buildPlannerPrompt(payload: PlannerInputPayload, template: ReturnType<typeof getReviewPlannerStrategyMeta>) {
  return `你是复习计划 AI Planner。请只基于给定候选集重排题目，不得输出候选集之外的 question_id。

策略模板：${template.strategy_template}
策略标签：${template.strategy_label}
策略说明：${template.prompt_hint}
权重画像：${JSON.stringify(template.weighting_profile)}

请输出严格 JSON，不要输出 markdown，不要输出解释文字。
输出格式：
{
  "request_id": "${payload.request_id}",
  "plan_version": "${buildReviewPlannerPlanVersion(template.strategy_template)}",
  "queue": [
    {
      "question_id": "候选集中的ID",
      "rank": 1,
      "reason": "一句中文原因",
      "suggested_interval_days": 1,
      "priority_score": 0-100数字,
      "strategy": "rescue|reinforce|new|revisit"
    }
  ],
  "mix": {
    "rescue": 0-1数字,
    "reinforce": 0-1数字,
    "new": 0-1数字,
    "revisit": 0-1数字
  },
  "risk": {
    "high_volatility": true,
    "high_fatigue": false,
    "missing_data": false,
    "notes": ["中文风险说明"]
  },
  "confidence": 0-1数字
}

约束：
1. queue 最多 ${payload.session_constraints.budget_count} 题。
2. 题目必须来自候选集 questions。
3. 优先满足 due 覆盖与高遗忘风险。
4. reason 必须简洁可解释。

输入：
${JSON.stringify(payload)}`;
}

function extractPlannerJson(content: string) {
  const plain = String(content || '').replace(/```json|```/gi, '').trim();
  const match = plain.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('planner_json_missing');
  }
  return JSON.parse(match[0]);
}

function inferPlannerStrategy(question: PlannerInputPayload['questions'][number], priorityScore: number): PlannerQueueItem['strategy'] {
  if (question.is_due) return 'rescue';
  if (question.review_count === 0) return 'new';
  if (question.lapse_count >= 2 || question.predicted_recall < 0.35 || priorityScore >= 80) return 'revisit';
  return 'reinforce';
}

function generateHeuristicPlannerOutput(
  payload: PlannerInputPayload,
  planVersion: string,
  template: ReturnType<typeof getReviewPlannerStrategyMeta>,
): PlannerOutputPayload {
  const ranked = [...payload.questions]
    .map((question) => {
      const urgencyScore = (question.is_due ? template.weighting_profile.due : 0)
        + (1 - clampNumber(question.predicted_recall, 0.5, 0, 1)) * template.weighting_profile.recall
        + clampNumber(question.lapse_count, 0, 0, 10) * template.weighting_profile.lapse
        + (1 - clampNumber(question.stability, 0.5, 0, 1)) * template.weighting_profile.stability
        + clampNumber(question.difficulty, 0.5, 0, 1) * template.weighting_profile.difficulty
        + (question.review_count === 0 ? template.weighting_profile.new_question : 0);
      const priorityScore = Math.round(Math.min(100, urgencyScore));
      const strategy = inferPlannerStrategy(question, priorityScore);
      const reason = question.is_due
        ? '到期题优先抢救，避免遗忘继续扩大'
        : strategy === 'revisit'
          ? '近期波动较大，建议优先回访巩固'
          : strategy === 'new'
            ? '新题首次进入计划，安排轻量试探'
            : '当前适合继续巩固，保持节奏';
      return {
        question,
        priorityScore,
        strategy,
        reason,
      };
    })
    .sort((left, right) => {
      if (right.priorityScore !== left.priorityScore) return right.priorityScore - left.priorityScore;
      return left.question.question_id.localeCompare(right.question.question_id, 'zh-CN');
    })
    .slice(0, Math.max(1, payload.session_constraints.budget_count));

  const total = ranked.length || 1;
  const mixCounter = {
    rescue: 0,
    reinforce: 0,
    new: 0,
    revisit: 0,
  };
  const queue = ranked.map((item, index) => {
    mixCounter[item.strategy] += 1;
    return {
      question_id: item.question.question_id,
      rank: index + 1,
      reason: item.reason,
      suggested_interval_days: item.question.is_due ? 1 : Math.max(1, Math.round((1 - item.question.predicted_recall) * 4)),
      priority_score: item.priorityScore,
      strategy: item.strategy,
    };
  });
  return {
    request_id: payload.request_id,
    plan_version: planVersion,
    queue,
    mix: {
      rescue: Number((mixCounter.rescue / total).toFixed(3)),
      reinforce: Number((mixCounter.reinforce / total).toFixed(3)),
      new: Number((mixCounter.new / total).toFixed(3)),
      revisit: Number((mixCounter.revisit / total).toFixed(3)),
    },
    risk: {
      high_volatility: ranked.some((item) => item.question.lapse_count >= 2),
      high_fatigue: ranked.filter((item) => item.question.difficulty >= 0.75).length >= Math.max(3, Math.floor(total * 0.6)),
      missing_data: payload.questions.some((item) => item.predicted_recall === 0 && item.stability === 0),
      notes: ['未配置外部模型时使用本地启发式重排'],
    },
    confidence: 0.68,
  };
}

function normalizePlannerOutput(raw: any, payload: PlannerInputPayload, planVersion: string): PlannerOutputPayload {
  const queue = Array.isArray(raw?.queue) ? raw.queue : [];
  if (!queue.length) {
    throw new Error('planner_queue_empty');
  }
  return {
    request_id: String(raw?.request_id || payload.request_id || '').trim() || payload.request_id,
    plan_version: String(raw?.plan_version || '').trim() || planVersion,
    queue: queue.map((item: any, index: number) => ({
      question_id: String(item?.question_id || '').trim(),
      rank: Math.max(1, Math.round(clampNumber(item?.rank, index + 1, 1, 999))),
      reason: String(item?.reason || '').trim() || 'AI 未提供理由，已按候选特征兜底',
      suggested_interval_days: Math.max(1, Math.round(clampNumber(item?.suggested_interval_days, 1, 1, 365))),
      priority_score: clampNumber(item?.priority_score, 50, 0, 100),
      strategy: REVIEW_PLANNER_STRATEGIES.includes(item?.strategy) ? item.strategy : 'reinforce',
    })),
    mix: {
      rescue: clampNumber(raw?.mix?.rescue, 0, 0, 1),
      reinforce: clampNumber(raw?.mix?.reinforce, 0, 0, 1),
      new: clampNumber(raw?.mix?.new, 0, 0, 1),
      revisit: clampNumber(raw?.mix?.revisit, 0, 0, 1),
    },
    risk: {
      high_volatility: Boolean(raw?.risk?.high_volatility),
      high_fatigue: Boolean(raw?.risk?.high_fatigue),
      missing_data: Boolean(raw?.risk?.missing_data),
      notes: Array.isArray(raw?.risk?.notes) ? raw.risk.notes.map((item: unknown) => String(item || '').trim()).filter(Boolean) : [],
    },
    confidence: clampNumber(raw?.confidence, 0.65, 0, 1),
  };
}

function summarizePlannerComparison(ruleQueue: Question[], aiQueue: PlannerQueueItem[] | undefined, executionQueue: Question[], notes: string[]) {
  const ruleIds = new Set(ruleQueue.map((item) => item.id));
  const aiIds = new Set((aiQueue || []).map((item) => item.question_id).filter(Boolean));
  const executionIds = new Set(executionQueue.map((item) => item.id));
  const aiOverlap = [...ruleIds].filter((item) => aiIds.has(item)).length;
  const finalOverlap = [...ruleIds].filter((item) => executionIds.has(item)).length;
  const executionDueCount = executionQueue.filter((item) => !!item.next_review_date && new Date(item.next_review_date) <= new Date()).length;
  return {
    rule_count: ruleIds.size,
    ai_count: aiIds.size,
    execution_count: executionIds.size,
    ai_rule_overlap_count: aiOverlap,
    execution_rule_overlap_count: finalOverlap,
    execution_due_count: executionDueCount,
    execution_due_ratio: executionIds.size > 0 ? Number((executionDueCount / executionIds.size).toFixed(3)) : 0,
    guardrail_notes: notes,
  };
}

function applyPlannerGuardrails(input: {
  payload: PlannerInputPayload;
  ruleQueue: Question[];
  plannerOutput: PlannerOutputPayload;
  strategyTemplate: string;
  strategyLabel: string;
  planningLatencyMs: number;
  rolloutMetadata: ReviewPlannerRunResult['rollout_metadata'];
}): ReviewPlannerRunResult {
  const { payload, ruleQueue, plannerOutput, strategyTemplate, strategyLabel, planningLatencyMs, rolloutMetadata } = input;
  const budget = Math.max(1, payload.session_constraints.budget_count);
  const candidateMap = new Map(payload.questions.map((item) => [item.question_id, item] as const));
  const ruleMap = new Map(ruleQueue.map((item) => [item.id, item] as const));
  const notes: string[] = [];
  const normalizedQueue: PlannerQueueItem[] = [];
  const pickedIds = new Set<string>();
  const dueCandidateIds = payload.questions.filter((item) => item.is_due).map((item) => item.question_id);
  const requiredDueCount = dueCandidateIds.length > 0
    ? Math.min(budget, Math.ceil(budget * payload.system_constraints.due_min_ratio), dueCandidateIds.length)
    : 0;

  for (const item of plannerOutput.queue) {
    const questionId = String(item.question_id || '').trim();
    if (!questionId) continue;
    const candidate = candidateMap.get(questionId);
    const questionRow = ruleMap.get(questionId);
    if (!candidate || !questionRow) {
      notes.push(`removed_invalid_candidate:${questionId}`);
      continue;
    }
    if (pickedIds.has(questionId)) {
      notes.push(`removed_duplicate:${questionId}`);
      continue;
    }
    if (payload.system_constraints.archived_excluded && (candidate.is_archived || questionRow.is_archived || questionRow.mastery_state === 'archived')) {
      notes.push(`removed_archived:${questionId}`);
      continue;
    }
    if (!candidate.is_due && candidate.last_interval_days > 0 && candidate.last_interval_days < payload.system_constraints.min_interval_days) {
      notes.push(`removed_min_interval:${questionId}`);
      continue;
    }
    pickedIds.add(questionId);
    normalizedQueue.push({
      ...item,
      question_id: questionId,
      rank: normalizedQueue.length + 1,
      suggested_interval_days: Math.max(payload.system_constraints.min_interval_days, item.suggested_interval_days || 1),
      priority_score: clampNumber(item.priority_score, 50, 0, 100),
      strategy: item.strategy || inferPlannerStrategy(candidate, clampNumber(item.priority_score, 50, 0, 100)),
    });
    if (normalizedQueue.length >= budget) break;
  }

  const appendRuleQuestion = (question: Question, reason: string) => {
    if (pickedIds.has(question.id) || question.is_archived || question.mastery_state === 'archived') return false;
    pickedIds.add(question.id);
    normalizedQueue.push({
      question_id: question.id,
      rank: normalizedQueue.length + 1,
      reason,
      suggested_interval_days: Math.max(payload.system_constraints.min_interval_days, Math.round(question.last_interval_days || 1)),
      priority_score: clampNumber(question.priority_score, 50, 0, 100),
      strategy: !!question.next_review_date && new Date(question.next_review_date) <= new Date() ? 'rescue' : 'reinforce',
    });
    return true;
  };

  if (normalizedQueue.length < budget) {
    for (const question of ruleQueue) {
      if (normalizedQueue.length >= budget) break;
      if (appendRuleQuestion(question, '规则补齐预算缺口')) {
        notes.push(`filled_budget:${question.id}`);
      }
    }
  }

  const countDue = () => normalizedQueue.filter((item) => candidateMap.get(item.question_id)?.is_due).length;
  let dueCount = countDue();
  if (dueCount < requiredDueCount) {
    for (const question of ruleQueue) {
      if (dueCount >= requiredDueCount) break;
      const candidate = candidateMap.get(question.id);
      if (!candidate?.is_due || pickedIds.has(question.id)) continue;
      const replaceIndex = normalizedQueue.findIndex((item) => !candidateMap.get(item.question_id)?.is_due);
      if (replaceIndex >= 0) {
        const removed = normalizedQueue.splice(replaceIndex, 1)[0];
        if (removed) pickedIds.delete(removed.question_id);
      }
      if (appendRuleQuestion(question, '规则补齐 due 覆盖')) {
        notes.push(`filled_due:${question.id}`);
        dueCount = countDue();
      }
    }
  }

  const executionQueue = normalizedQueue
    .slice(0, budget)
    .map((item) => ruleMap.get(item.question_id))
    .filter((item): item is Question => Boolean(item));
  const finalDueCount = executionQueue.filter((item) => !!item.next_review_date && new Date(item.next_review_date) <= new Date()).length;
  const finalDueRatio = executionQueue.length > 0 ? finalDueCount / executionQueue.length : 0;

  if (!executionQueue.length) {
    return {
      request_id: payload.request_id,
      plan_source: 'rule_fallback',
      plan_version: `${plannerOutput.plan_version}-fallback`,
      fallback_reason: 'guardrail_unrecoverable',
      planning_latency_ms: planningLatencyMs,
      strategy_template: strategyTemplate,
      strategy_label: strategyLabel,
      execution_queue: ruleQueue.slice(0, budget),
      rule_queue: ruleQueue.slice(0, budget),
      ai_queue: plannerOutput.queue,
      reasons: ['护栏修复后无可执行题目，已切回规则队列'],
      confidence: plannerOutput.confidence,
      comparison_summary: summarizePlannerComparison(ruleQueue.slice(0, budget), plannerOutput.queue, ruleQueue.slice(0, budget), [...notes, 'fallback:guardrail_unrecoverable']),
      risk_flags: {
        ...plannerOutput.risk,
        strategy_template: strategyTemplate,
        strategy_label: strategyLabel,
      },
      rollout_metadata: rolloutMetadata,
    };
  }

  if (requiredDueCount > 0 && finalDueRatio < payload.system_constraints.due_min_ratio) {
    return {
      request_id: payload.request_id,
      plan_source: 'rule_fallback',
      plan_version: `${plannerOutput.plan_version}-fallback`,
      fallback_reason: 'due_min_ratio_unmet',
      planning_latency_ms: planningLatencyMs,
      strategy_template: strategyTemplate,
      strategy_label: strategyLabel,
      execution_queue: ruleQueue.slice(0, budget),
      rule_queue: ruleQueue.slice(0, budget),
      ai_queue: plannerOutput.queue,
      reasons: ['AI 计划未满足 due 覆盖护栏，已切回规则队列'],
      confidence: plannerOutput.confidence,
      comparison_summary: summarizePlannerComparison(ruleQueue.slice(0, budget), plannerOutput.queue, ruleQueue.slice(0, budget), [...notes, 'fallback:due_min_ratio_unmet']),
      risk_flags: {
        ...plannerOutput.risk,
        strategy_template: strategyTemplate,
        strategy_label: strategyLabel,
      },
      rollout_metadata: rolloutMetadata,
    };
  }

  const reasons = normalizedQueue.slice(0, 3).map((item) => item.reason).filter(Boolean);
  return {
    request_id: payload.request_id,
    plan_source: 'ai',
    plan_version: plannerOutput.plan_version,
    planning_latency_ms: planningLatencyMs,
    strategy_template: strategyTemplate,
    strategy_label: strategyLabel,
    execution_queue: executionQueue,
    rule_queue: ruleQueue.slice(0, budget),
    ai_queue: normalizedQueue.slice(0, budget),
    reasons: reasons.length ? reasons : ['AI 已重排本次复习顺序'],
    confidence: plannerOutput.confidence,
    comparison_summary: summarizePlannerComparison(ruleQueue.slice(0, budget), normalizedQueue.slice(0, budget), executionQueue, notes),
    risk_flags: {
      ...plannerOutput.risk,
      strategy_template: strategyTemplate,
      strategy_label: strategyLabel,
    },
    rollout_metadata: rolloutMetadata,
  };
}

async function persistPlannerTelemetry(userId: string, payload: PlannerInputPayload, result: ReviewPlannerRunResult) {
  const insertPayload = {
    user_id: userId,
    request_id: result.request_id,
    plan_source: result.plan_source,
    plan_version: result.plan_version,
    fallback_reason: result.fallback_reason || null,
    schema_validation_passed: result.plan_source === 'ai',
    planning_latency_ms: result.planning_latency_ms,
    request_summary: {
      subject: payload.session_constraints.subjects[0] || null,
      budget_count: payload.session_constraints.budget_count,
      prefer_due: payload.session_constraints.prefer_due,
      strategy_template: result.strategy_template,
      strategy_label: result.strategy_label,
      rollout: result.rollout_metadata || null,
    },
    rule_queue_snapshot: buildRuleQueueSnapshot(result.rule_queue),
    shadow_queue_snapshot: result.ai_queue || null,
    comparison_summary: result.comparison_summary || null,
    risk_flags: result.risk_flags || null,
  };
  await supabase.from('review_plan_telemetry').insert(insertPayload as never).throwOnError().catch((error) => {
    if (String(error?.message || '').includes('relation "review_plan_telemetry" does not exist')) {
      return;
    }
    console.warn('Failed to insert review_plan_telemetry:', error?.message || error);
  });
}

async function requestLivePlannerOutput(input: {
  payload: PlannerInputPayload;
  strategyMeta: ReturnType<typeof getReviewPlannerStrategyMeta>;
  signal: AbortSignal;
}) {
  const env = (import.meta as any).env || {};
  const apiKey = String(env.VITE_DASHSCOPE_API_KEY || env.NEXT_PUBLIC_DASHSCOPE_API_KEY || '').trim();
  const planVersion = buildReviewPlannerPlanVersion(input.strategyMeta.strategy_template);
  if (!apiKey) {
    return generateHeuristicPlannerOutput(input.payload, planVersion, input.strategyMeta);
  }
  const plannerGuard = acquireAiRequestGuard({
    key: buildPlannerGuardKey(input.payload, input.strategyMeta.strategy_template),
  });
  const response = await fetch(getAiProxyUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: env.VITE_QWEN_MODEL || env.NEXT_PUBLIC_QWEN_MODEL || 'qwen3.5-plus',
      stream: false,
      messages: [
        {
          role: 'system',
          content: buildPlannerPrompt(input.payload, input.strategyMeta),
        },
      ],
    }),
    signal: input.signal,
  }).catch((err) => {
    plannerGuard.release('failed');
    throw err;
  });
  try {
    if (!response.ok) {
      throw new Error(`planner_http_${response.status}`);
    }
    const body = await response.json();
    const content = String(body?.choices?.[0]?.message?.content || '').trim();
    if (!content) {
      throw new Error('planner_empty_content');
    }
    const normalized = normalizePlannerOutput(extractPlannerJson(content), input.payload, planVersion);
    plannerGuard.release('success');
    return normalized;
  } catch (err) {
    plannerGuard.release('failed');
    throw err;
  }
}

// Levenshtein distance for fuzzy matching
function getEditDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(null));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

async function normalizeQuestionTagsForWrite(input: {
  subject?: string;
  knowledgePoint?: string;
}) {
  await hydrateTagDictionaryOnce();
  const baseTags = normalizeQuestionTags(input);
  
  // Get custom tags from learning state
  let customKnowledgePoints: string[] = [];
  try {
    const state = await userLearningStateApi.get();
    customKnowledgePoints = state.tag_extensions?.knowledge_point || [];
  } catch (err) {
    // Ignore error, fallback to base
  }

  const subject = baseTags.subject;
  const allKps = [...(subject === '英语' ? getKnowledgePointsBySubject('英语') : getKnowledgePointsBySubject('C语言')), ...customKnowledgePoints];
  let finalKp = input.knowledgePoint ? input.knowledgePoint.trim() : baseTags.knowledgePoint;

  // Fuzzy match knowledge point if not exactly in list
  if (finalKp && !allKps.includes(finalKp)) {
    let bestMatch = finalKp;
    let minDistance = Infinity;
    for (const kp of allKps) {
      if (kp.includes(finalKp) || finalKp.includes(kp)) {
        bestMatch = kp;
        break; // substring match is strong
      }
      const dist = getEditDistance(finalKp, kp);
      if (dist <= 2 && dist < minDistance) {
        minDistance = dist;
        bestMatch = kp;
      }
    }
    finalKp = bestMatch;
  }
  if (!finalKp) {
    throw new Error('缺少知识点标签，无法写入错题。请先选择或创建知识点。');
  }
  if (!allKps.includes(finalKp)) {
    throw new Error(`知识点「${finalKp}」尚未创建，无法写入错题。请先显式创建标签或改为现有标签。`);
  }

  return {
    subject,
    knowledgePoint: finalKp,
    ability: '',
    errorType: '',
  };
}

function isMissingColumnError(error: any) {
  const msg = String(error?.message || '').toLowerCase();
  const hasColumnContext = msg.includes('column') || msg.includes('schema cache');
  const isMissingSignal =
    msg.includes('does not exist') ||
    msg.includes('not found') ||
    msg.includes('could not find');
  return hasColumnContext && isMissingSignal;
}

function isMissingRelationError(error: any) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('relation') && msg.includes('does not exist');
}

function isMissingFunctionError(error: any) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('function') && msg.includes('does not exist');
}

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const EMPTY_LEARNING_CONTENT: LearningContentState = {
  tipsByNode: {},
  drawerByTag: {},
};

const EMPTY_USER_LEARNING_STATE: Omit<UserLearningStateRecord, 'user_id'> = {
  tag_extensions: {},
  taxonomy_overrides: {},
  learning_content: EMPTY_LEARNING_CONTENT,
};

let pendingLearningStatePatch: Partial<Omit<UserLearningStateRecord, 'user_id'>> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function mergeLearningStatePatch(base: Partial<Omit<UserLearningStateRecord, 'user_id'>> | null, patch: Partial<Omit<UserLearningStateRecord, 'user_id'>>) {
  return {
    ...(base || {}),
    ...patch,
  };
}

function clearRetryTimer() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetry() {
  clearRetryTimer();
  retryTimer = setTimeout(() => {
    void userLearningStateApi.retryPending();
  }, 4000);
}

type CacheEntry<T> = {
  value: T;
  timestamp: number;
  signature?: string;
};

const QUESTIONS_CACHE_TTL_MS = 3 * 60 * 1000;
const WEAKNESS_CACHE_TTL_MS = 2 * 60 * 1000;
const STATS_CACHE_TTL_MS = 60 * 1000;
const LEARNING_STATE_CACHE_TTL_MS = 2 * 60 * 1000;

const questionsCache = new Map<string, CacheEntry<Question[]>>();
const weaknessCache = new Map<string, CacheEntry<UserWeakness[]>>();
const statsCache = new Map<string, CacheEntry<Stats>>();
const learningStateCache = new Map<string, CacheEntry<UserLearningStateRecord>>();
const generationCache = new Map<string, CacheEntry<GovernedGenerationResult>>();
let learningStateInFlight: Promise<UserLearningStateRecord> | null = null;

function isClient() {
  return typeof window !== 'undefined';
}

function isLegacyDbFallbackEnabled() {
  const env = (import.meta as any).env || {};
  return String(env.VITE_ENABLE_LEGACY_DB_FALLBACK || '').toLowerCase() === 'true';
}

function trackCacheEvent(eventType: string, startedAt: number) {
  const latencyMs = Date.now() - startedAt;
  void questionsApi.submitPerfTelemetry({
    eventType,
    latencyMs,
  }).catch(() => {});
}

function readCacheFromStorage<T>(key: string): CacheEntry<T> | null {
  if (!isClient()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.timestamp !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCacheToStorage<T>(key: string, entry: CacheEntry<T>) {
  if (!isClient()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(entry));
  } catch {
  }
}

function removeCacheFromStorage(key: string) {
  if (!isClient()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
  }
}

async function readPersistentCache<T>(
  bucket: 'questions' | 'weakness' | 'stats' | 'learning-state',
  key: string,
): Promise<CacheEntry<T> | null> {
  const storage = readCacheFromStorage<T>(key);
  if (storage) return storage;
  const persisted = await persistentCacheAdapter.get<T>(bucket, key);
  if (persisted) {
    writeCacheToStorage(key, persisted);
  }
  return persisted;
}

async function writePersistentCache<T>(
  bucket: 'questions' | 'weakness' | 'stats' | 'learning-state',
  key: string,
  entry: CacheEntry<T>,
) {
  writeCacheToStorage(key, entry);
  await persistentCacheAdapter.set(bucket, key, entry);
}

async function removePersistentCache(
  bucket: 'questions' | 'weakness' | 'stats' | 'learning-state',
  key: string,
) {
  removeCacheFromStorage(key);
  await persistentCacheAdapter.remove(bucket, key);
}

function isCacheFresh(timestamp: number, ttlMs: number) {
  return Date.now() - timestamp <= ttlMs;
}

function getQuestionsCacheKey(userId: string) {
  return `aiweb_questions_cache_v1:${userId}`;
}

function getWeaknessCacheKey(userId: string) {
  return `aiweb_weakness_cache_v1:${userId}`;
}

function getStatsCacheKey(userId: string) {
  return `aiweb_stats_cache_v1:${userId}`;
}

function getLearningStateCacheKey(userId: string) {
  return `aiweb_learning_state_cache_v1:${userId}`;
}

function buildQuestionsSignature(rows: Array<{ id?: string; created_at?: string }>) {
  const head = rows[0];
  return `${rows.length}:${head?.id || ''}:${head?.created_at || ''}`;
}

function buildWeaknessSignature(rows: Array<{ id?: string; error_count?: number; last_updated?: string }>) {
  const totalErrors = rows.reduce((sum, item) => sum + (item.error_count || 0), 0);
  const head = rows[0];
  return `${rows.length}:${totalErrors}:${head?.id || ''}:${head?.last_updated || ''}`;
}

function extractJsonArrayText(raw: string) {
  const plain = raw.replace(/```json|```/gi, '').trim();
  const arrayMatch = plain.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];
  const objectMatch = plain.match(/\{[\s\S]*\}/);
  if (!objectMatch) return '';
  return objectMatch[0];
}

function sanitizeJsonText(raw: string) {
  return raw
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/\uFEFF/g, '')
    .trim();
}

function parseGeneratedList(fullContent: string) {
  const jsonText = extractJsonArrayText(fullContent);
  if (!jsonText) throw new Error('生成格式错误');
  const firstParse = JSON.parse(sanitizeJsonText(jsonText));
  if (Array.isArray(firstParse)) return firstParse;
  const variants = firstParse?.variants;
  if (Array.isArray(variants)) return variants;
  throw new Error('生成格式错误');
}

function shouldKeepGeneratedQuestion(item: VariantQuestion, subject: Subject) {
  const text = String(item.question_text || '').trim();
  if (!text) return false;
  if (item.question_type === 'choice' && (!Array.isArray(item.options) || item.options.length < 2)) return false;
  if (!String(item.correct_answer || '').trim()) return false;
  const readingHint = /阅读|短文|文章|passage|main idea|according to the passage|the passage/i.test(text);
  if (readingHint) {
    if (subject === '英语') {
      const wordCount = (text.match(/[A-Za-z]+/g) || []).length;
      if (wordCount < 70) return false;
    } else if (text.length < 140) {
      return false;
    }
  }
  return true;
}

function getGenerationCacheKey(input: GovernedGenerationRequest) {
  return [
    input.subject,
    input.strategy,
    input.objectiveCode,
    input.amount,
    input.nodes.map((item) => item.trim()).filter(Boolean).sort().join('|'),
    input.generationPolicy.allowAiGenerate ? 'ai' : 'no-ai',
    input.generationPolicy.allowCache ? 'cache' : 'no-cache',
    input.generationPolicy.allowRuleFallback ? 'rule' : 'no-rule',
  ].join('::');
}

function getWritebackLedgerKey(idempotencyKey: string) {
  return `aiweb_learning_writeback_v1:${idempotencyKey}`;
}

function readWritebackLedger<T>(idempotencyKey?: string): T | null {
  if (!idempotencyKey) return null;
  return readCacheFromStorage<T>(getWritebackLedgerKey(idempotencyKey))?.value || null;
}

function writeWritebackLedger<T>(idempotencyKey: string | undefined, value: T) {
  if (!idempotencyKey) return;
  writeCacheToStorage(getWritebackLedgerKey(idempotencyKey), {
    value,
    timestamp: Date.now(),
  });
}

function buildGenerationPrompt(input: GovernedGenerationRequest, amount: number) {
  const templateHint = input.subject === '英语'
    ? '优先生成单选或短填空，阅读题必须提供完整语篇。'
    : '优先生成代码理解、程序输出或语法判断题，保证题干自洽。';
  return `请作为专业教师，针对${input.subject}学科生成 ${amount} 道变式训练题。
${input.nodes.length > 0 ? `考察的知识点为：${input.nodes.join('、')}。` : ''}
本轮学习目标：${input.explanationSummary || input.sourceReason || input.successCriteria}
出题策略要求为：【${input.strategy}】。
治理要求：
1. 题目必须完整且可判定。
2. 选择题至少 4 个可区分选项，答案必须唯一。
3. ${templateHint}
4. 返回格式必须是纯 JSON 数组，不要输出 Markdown。
JSON 格式如下：
[
  {
    "level": 1,
    "question_type": "choice",
    "question_text": "完整题目",
    "options": ["A. 选项1", "B. 选项2", "C. 选项3", "D. 选项4"],
    "correct_answer": "A",
    "explanation": "详细解析"
  }
]`;
}

function normalizeGeneratedVariants(rawList: any[], subject: Subject, sourceKind: VariantQuestion['source_kind']): VariantQuestion[] {
  return rawList.map((entry: any, idx: number) => {
    const item = entry && typeof entry === 'object' ? entry as Record<string, any> : {};
    const options = (Array.isArray(item.options) ? item.options : [])
      .map((rawOption: any, optionIdx: number) => {
        if (typeof rawOption === 'string') return rawOption.trim();
        if (rawOption && typeof rawOption === 'object') {
          const optionRecord = rawOption as Record<string, unknown>;
          const textValue = typeof optionRecord.text === 'string' ? optionRecord.text.trim() : '';
          if (textValue) {
            const rawLabel = typeof optionRecord.label === 'string' ? optionRecord.label : '';
            const label = rawLabel.match(/[A-H]/i)?.[0]?.toUpperCase() || String.fromCharCode(65 + optionIdx);
            return `${label}. ${textValue}`;
          }
          const pair = Object.entries(optionRecord).find(([, value]) => typeof value === 'string' && String(value).trim().length > 0);
          if (pair) {
            const [key, value] = pair;
            const label = key.match(/[A-H]/i)?.[0]?.toUpperCase() || String.fromCharCode(65 + optionIdx);
            return `${label}. ${String(value).trim()}`;
          }
        }
        return String(rawOption ?? '').trim();
      })
      .filter((value: string) => value.length > 0)
      .map((value: string, optionIdx: number) => {
        const label = String.fromCharCode(65 + optionIdx);
        const text = value.replace(/^[A-H][\.．、:：\)）\]]\s*/i, '').trim();
        return `${label}. ${text || value}`;
      });
    const rawType = item.question_type === 'choice' || item.question_type === 'fill'
      ? item.question_type
      : (item.questionType === 'choice' || item.questionType === 'fill' ? item.questionType : 'fill');
    const question_type = rawType === 'choice' && options.length < 2 ? 'fill' : rawType;
    const variant: VariantQuestion = {
      level: Number(item.level) > 0 ? Number(item.level) : (idx + 1),
      question_type,
      question_text: String(item.question_text || item.question || '题目加载失败'),
      options: question_type === 'choice' ? options : [],
      correct_answer: String(item.correct_answer || item.correctAnswer || ''),
      acceptable_answers: [],
      explanation: String(item.explanation || item.analysis || '暂无解析'),
      source_kind: sourceKind,
      source_label: sourceKind === 'cache' ? '缓存复用' : sourceKind === 'rule_fallback' ? '规则模板' : 'AI 生成',
      validation_status: 'accepted',
    };
    return variant;
  }).filter((item) => item.question_text.trim().length > 0 && shouldKeepGeneratedQuestion(item, subject));
}

function buildRuleFallbackVariants(input: GovernedGenerationRequest, amount: number): VariantQuestion[] {
  const nodes = input.nodes.length > 0 ? input.nodes : [input.subject === '英语' ? '核心知识点' : '基础语法'];
  return Array.from({ length: Math.max(1, amount) }, (_, index) => {
    const node = nodes[index % nodes.length];
    if (input.subject === '英语') {
      return {
        level: Math.min(5, index + 1),
        question_type: 'choice',
        question_text: `请判断关于「${node}」的句子哪一项更符合本轮训练目标。\nA. 只关注表面词汇\nB. 结合语境与语法线索判断\nC. 完全忽略题干\nD. 只看选项长度`,
        options: [
          'A. 只关注表面词汇',
          'B. 结合语境与语法线索判断',
          'C. 完全忽略题干',
          'D. 只看选项长度',
        ],
        correct_answer: 'B',
        acceptable_answers: [],
        explanation: `本题用于稳定覆盖 ${node} 的基础判断流程，帮助你先进入练习状态。`,
        source_kind: 'rule_fallback',
        source_label: '规则模板',
        validation_status: 'accepted',
      } as VariantQuestion;
    }
    return {
      level: Math.min(5, index + 1),
      question_type: 'fill',
      question_text: `围绕「${node}」回答：写出一个判断程序输出或语法是否合法时必须先检查的关键点。`,
      options: [],
      correct_answer: '输入输出约束与语法条件',
      acceptable_answers: ['语法条件与边界', '边界条件和语法约束'],
      explanation: `本题用于规则模板兜底，确保在 AI 不稳定时仍能围绕 ${node} 开始正式训练。`,
      source_kind: 'rule_fallback',
      source_label: '规则模板',
      validation_status: 'accepted',
    } as VariantQuestion;
  });
}

async function submitBestEffortInsert(table: string, payload: Record<string, unknown>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || isLocalDataApiMode()) return;
  const result = await supabase.from(table).insert({
    user_id: user.id,
    ...payload,
  });
  if (result.error && !isMissingRelationError(result.error)) {
    return;
  }
}

export type SemanticDuplicatePairInput = {
  existingQuestionText: string;
  incomingQuestionText: string;
};

export type SemanticDuplicatePairResult = {
  is_duplicate: boolean;
  confidence: number;
  reason: string;
};

// ---- Auth ----
export const authApi = {
  register: async (email: string, password: string, name: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name }
      }
    });
    if (error) throw new Error(error.message);
    return data;
  },
  login: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return data;
  },
  logout: async () => {
    await supabase.auth.signOut();
  },
};

// ---- Weakness Stats ----
export const weaknessApi = {
  getAll: async (options?: { forceRefresh?: boolean }): Promise<UserWeakness[]> => {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) throw new Error('未登录');
    const storageKey = getWeaknessCacheKey(user.id);
    const inMemory = weaknessCache.get(user.id);
    const startedAt = Date.now();
    const persisted = inMemory || await readPersistentCache<UserWeakness[]>('weakness', storageKey);
    if (persisted) {
      weaknessCache.set(user.id, persisted);
      if (!options?.forceRefresh && isCacheFresh(persisted.timestamp, WEAKNESS_CACHE_TTL_MS)) {
        trackCacheEvent('cache_weakness_hit', startedAt);
        return persisted.value;
      }
    }
    let result: UserWeakness[] = [];
    try {
      if (isLocalDataApiMode()) {
        const token = await getAccessToken();
        const response = await localDataApiFetch<{ data: UserWeakness[] }>(token, '/weakness');
        result = (response.data || []) as UserWeakness[];
      } else {
        const { data, error } = await supabase
          .from('user_weakness')
          .select('*')
          .eq('user_id', user.id)
          .order('error_count', { ascending: false });
        if (error) throw new Error(error.message);
        result = (data || []) as UserWeakness[];
      }
    } catch (error: any) {
      if (persisted) return persisted.value;
      throw error;
    }
    const entry: CacheEntry<UserWeakness[]> = {
      value: result,
      timestamp: Date.now(),
      signature: buildWeaknessSignature(result),
    };
    weaknessCache.set(user.id, entry);
    await writePersistentCache('weakness', storageKey, entry);
    trackCacheEvent('cache_weakness_miss', startedAt);
    return result;
  },
  
  incrementError: async (knowledgePoint: string): Promise<void> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');

    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      await localDataApiFetch<{ data: { ok: true } }>(token, '/weakness/increment', {
        method: 'POST',
        body: JSON.stringify({
          knowledge_point: knowledgePoint,
        }),
      });
      weaknessApi.invalidateCache(user.id);
      statsApi.invalidateCache(user.id);
      return;
    }
    const rpc = await supabase.rpc('increment_user_weakness', {
      p_knowledge_point: knowledgePoint,
      p_ability: '',
    });
    if (!rpc.error) {
      weaknessApi.invalidateCache(user.id);
      statsApi.invalidateCache(user.id);
      return;
    }
    if (!isMissingFunctionError(rpc.error)) {
      throw new Error(rpc.error.message);
    }

    const existingResult = await supabase
      .from('user_weakness')
      .select('*')
      .eq('user_id', user.id)
      .eq('knowledge_point', knowledgePoint)
      .maybeSingle();
    if (existingResult.error) throw new Error(existingResult.error.message);
    const existing = existingResult.data;
      
    if (existing) {
      const updateResult = await supabase
        .from('user_weakness')
        .update({ 
          error_count: existing.error_count + 1,
          last_updated: new Date().toISOString()
        })
        .eq('id', existing.id);
      if (updateResult.error) throw new Error(updateResult.error.message);
    } else {
      const insertResult = await supabase
        .from('user_weakness')
        .insert({
          user_id: user.id,
          knowledge_point: knowledgePoint,
          error_count: 1
        });
      if (insertResult.error) throw new Error(insertResult.error.message);
    }
    weaknessApi.invalidateCache(user.id);
    statsApi.invalidateCache(user.id);
  },

  invalidateCache: (userId?: string) => {
    if (userId) {
      weaknessCache.delete(userId);
      void removePersistentCache('weakness', getWeaknessCacheKey(userId));
      return;
    }
    weaknessCache.clear();
  }
};

export const knowledgeNodesApi = {
  async getAll(): Promise<Array<{ subject: string; category: string; branch?: string; node: string; tips_and_tricks: string }>> {
    if (isLocalDataApiMode()) {
      const token = await getAccessTokenOrLocalFallback();
      const res = await localDataApiFetch<{ data: any }>(token, '/knowledge-nodes');
      return Array.isArray(res.data) ? res.data.map((item: any) => normalizeKnowledgeNodeRow(item)) : [];
    }
    const { data, error } = await supabase.from('knowledge_nodes').select('*');
    if (error) throw error;
    return Array.isArray(data) ? data.map((item) => normalizeKnowledgeNodeRow(item)) : [];
  },
  async upsertMany(nodes: Array<{ subject: string; category: string; branch?: string; node: string; tips_and_tricks?: string }>): Promise<void> {
    if (!nodes.length) return;
    if (isLocalDataApiMode()) {
      const token = await getAccessTokenOrLocalFallback();
      await localDataApiFetch<{ data: { ok: true } }>(token, '/knowledge-nodes/upsert', {
        method: 'POST',
        body: JSON.stringify({ nodes }),
      });
      return;
    }
    const { error } = await supabase
      .from('knowledge_nodes')
      .upsert(nodes, { onConflict: 'subject,category,node' });
    if (error) throw error;
  },
  async deleteNode(subject: string, node: string, category?: string): Promise<void> {
    if (!subject || !node) return;
    if (isLocalDataApiMode()) {
      const token = await getAccessTokenOrLocalFallback();
      await localDataApiFetch<{ data: { ok: true } }>(token, '/knowledge-nodes/delete', {
        method: 'POST',
        body: JSON.stringify({ subject, node, category }),
      });
      return;
    }
    let query = supabase
      .from('knowledge_nodes')
      .delete()
      .eq('subject', subject)
      .eq('node', node);
    if (category) {
      query = query.eq('category', category);
    }
    const { error } = await query;
    if (error) throw error;
  }
};

export const taxonomyApi = {
  upsertKnowledgePoint: async (input: { subject: Subject; knowledgePoint: string; category: string; branch?: string }) => {
    const subject = input.subject === 'C语言' ? 'C语言' : '英语';
    const knowledgePoint = String(input.knowledgePoint || '').trim();
    const category = String(input.category || '').trim() || '未分类';
    const branch = String(input.branch || '').trim() || '未分类';
    if (!knowledgePoint) {
      throw new Error('缺少知识点名称');
    }
    if (isLocalDataApiMode()) {
      const token = await getAccessTokenOrLocalFallback();
      const response = await localDataApiFetch<{ data: any }>(token, '/taxonomy/upsert', {
        method: 'POST',
        body: JSON.stringify({
          subject,
          knowledge_point: knowledgePoint,
          category,
          branch,
        }),
      });
      return normalizeTaxonomyWriteResult(response.data);
    }
    const { data, error } = await supabase.rpc('upsert_knowledge_taxonomy', {
      p_subject: subject,
      p_knowledge_point: knowledgePoint,
      p_category: category,
      p_branch: branch,
    });
    if (error) throw error;
    return normalizeTaxonomyWriteResult(data);
  },
};

export const tagIdApi = {
  getDictionary: async () => {
    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      const response = await localDataApiFetch<{ data: any }>(token, '/tag-dictionary');
      hydrateTagDictionaryFromPayload(response.data || {});
      return response.data;
    }
    await hydrateTagDictionaryOnce(true);
    const { data: tags, error } = await supabase
      .from('tag_catalog')
      .select('tag_id,subject,tag_name,category,branch,code')
      .order('tag_id', { ascending: true });
    if (error) throw new Error(error.message);
    return {
      tags: tags || [],
      dictionary: {
        by_subject: {
          knowledge_point: {
            英语: getKnowledgePointsBySubject('英语'),
            C语言: getKnowledgePointsBySubject('C语言'),
          },
          error_type: {},
          ability: {},
        },
        all: {
          knowledge_point: [...getKnowledgePointsBySubject('英语'), ...getKnowledgePointsBySubject('C语言')],
          error_type: [],
          ability: [],
        },
      },
    };
  },
  getPaths: async (params: { tagId?: string; questionId?: string } = {}) => {
    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      const query = new URLSearchParams();
      if (params.tagId) query.set('tagId', params.tagId);
      if (params.questionId) query.set('questionId', params.questionId);
      const response = await localDataApiFetch<{ data: any[] }>(token, `/tag-paths?${query.toString()}`);
      return Array.isArray(response.data) ? response.data.map((item) => attachCanonicalQuestionIds(item)) : [];
    }
    let request = supabase.from('questions').select('id,question_id,tag_id,id_path,knowledge_point_id,subject,knowledge_point').order('created_at', { ascending: false }).limit(200);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    request = request.eq('user_id', user.id);
    if (params.tagId) request = request.eq('tag_id', params.tagId);
    if (params.questionId) request = request.eq('question_id', params.questionId);
    const { data, error } = await request;
    if (error) throw new Error(error.message);
    return Array.isArray(data) ? data.map((item) => attachCanonicalQuestionIds(item)) : [];
  },
};

export const userLearningStateApi = {
  get: async (): Promise<UserLearningStateRecord> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    await hydrateTagDictionaryOnce();
    const inMemory = learningStateCache.get(user.id);
    if (inMemory && isCacheFresh(inMemory.timestamp, LEARNING_STATE_CACHE_TTL_MS)) {
      return inMemory.value;
    }
    if (learningStateInFlight) {
      return learningStateInFlight;
    }
    learningStateInFlight = (async () => {
      let data: any = null;
      let error: Error | null = null;
      if (isLocalDataApiMode()) {
        try {
          const token = await getAccessToken();
          const response = await localDataApiFetch<{ data: any }>(token, '/learning-state');
          data = response.data;
        } catch (err: any) {
          error = err;
        }
      } else {
        const result = await supabase
          .from('user_learning_state')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();
        data = result.data;
        error = result.error ? new Error(result.error.message) : null;
      }
      if (error && String(error.message || '').toLowerCase().includes('does not exist')) {
        setLearningSyncSnapshot({ state: 'error', message: '知识库表不存在' });
        const fallback = {
          user_id: user.id,
          ...EMPTY_USER_LEARNING_STATE,
        };
        const entry: CacheEntry<UserLearningStateRecord> = {
          value: fallback,
          timestamp: Date.now(),
        };
        learningStateCache.set(user.id, entry);
        return fallback;
      }
      if (error) {
        if (inMemory) return inMemory.value;
        setLearningSyncSnapshot({ state: 'error', message: '连接失败' });
        throw new Error(error.message);
      }
      if (!data) {
        setLearningSyncSnapshot({ state: 'synced', message: '已同步' });
        const fallback = {
          user_id: user.id,
          ...EMPTY_USER_LEARNING_STATE,
        };
        const entry: CacheEntry<UserLearningStateRecord> = {
          value: fallback,
          timestamp: Date.now(),
        };
        learningStateCache.set(user.id, entry);
        return fallback;
      }
      setLearningSyncSnapshot({ state: 'synced', message: '已同步' });
      const result = {
        user_id: user.id,
        tag_extensions: (data.tag_extensions || {}) as TagExtensions,
        taxonomy_overrides: (data.taxonomy_overrides || {}) as TaxonomyOverrideMap,
        learning_content: {
          tipsByNode: data.learning_content?.tipsByNode || {},
          drawerByTag: data.learning_content?.drawerByTag || {},
        },
        created_at: data.created_at,
        updated_at: data.updated_at,
      };
      const entry: CacheEntry<UserLearningStateRecord> = {
        value: result,
        timestamp: Date.now(),
      };
      learningStateCache.set(user.id, entry);
      void removePersistentCache('learning-state', getLearningStateCacheKey(user.id));
      return result;
    })();
    try {
      return await learningStateInFlight;
    } finally {
      learningStateInFlight = null;
    }
  },
  upsert: async (patch: Partial<Omit<UserLearningStateRecord, 'user_id'>>): Promise<UserLearningStateRecord> => {
    pendingLearningStatePatch = mergeLearningStatePatch(pendingLearningStatePatch, patch);
    setLearningSyncSnapshot({ state: 'syncing', message: '同步中...' });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    const current = await userLearningStateApi.get();
    const payload = {
      user_id: user.id,
      tag_extensions: patch.tag_extensions ?? current.tag_extensions,
      taxonomy_overrides: patch.taxonomy_overrides ?? current.taxonomy_overrides,
      learning_content: patch.learning_content ?? current.learning_content,
      updated_at: new Date().toISOString(),
    };
    const retryDelays = [0, 800, 1800];
    let lastError: any = null;
    for (let index = 0; index < retryDelays.length; index++) {
      const delay = retryDelays[index];
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      let data: any = null;
      let error: Error | null = null;
      if (isLocalDataApiMode()) {
        try {
          const token = await getAccessToken();
          const response = await localDataApiFetch<{ data: any }>(token, '/learning-state/upsert', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          data = response.data;
        } catch (err: any) {
          error = err;
        }
      } else {
        const result = await supabase
          .from('user_learning_state')
          .upsert(payload, { onConflict: 'user_id' })
          .select('*')
          .single();
        data = result.data;
        error = result.error ? new Error(result.error.message) : null;
      }
      if (error && String(error.message || '').toLowerCase().includes('does not exist')) {
        lastError = error;
        break;
      }
      if (!error && data) {
        pendingLearningStatePatch = null;
        clearRetryTimer();
        setLearningSyncSnapshot({ state: 'synced', message: '已同步' });
        const result = {
          user_id: user.id,
          tag_extensions: (data.tag_extensions || {}) as TagExtensions,
          taxonomy_overrides: (data.taxonomy_overrides || {}) as TaxonomyOverrideMap,
          learning_content: {
            tipsByNode: data.learning_content?.tipsByNode || {},
            drawerByTag: data.learning_content?.drawerByTag || {},
          },
          created_at: data.created_at,
          updated_at: data.updated_at,
        };
        const entry: CacheEntry<UserLearningStateRecord> = {
          value: result,
          timestamp: Date.now(),
        };
        learningStateCache.set(user.id, entry);
        void removePersistentCache('learning-state', getLearningStateCacheKey(user.id));
        return result;
      }
      lastError = error;
    }
    setLearningSyncSnapshot({
      state: 'error',
      message: String(lastError?.message || '').toLowerCase().includes('does not exist')
        ? '知识库表不存在'
        : '同步失败，自动重试中',
    });
    scheduleRetry();
    throw new Error(lastError?.message || '同步失败');
  },
  retryPending: async () => {
    if (!pendingLearningStatePatch) return null;
    const patch = pendingLearningStatePatch;
    return userLearningStateApi.upsert(patch);
  },
  hasPendingSync: () => Boolean(pendingLearningStatePatch),
};

function applyQuestionQuery(source: Question[], query: QuestionQuery = {}) {
  let result = [...source];
  const now = new Date();
  if (query.subject) result = result.filter(item => item.subject === query.subject);
  if (query.category) result = result.filter(item => (item.category || '未分类') === query.category);
  
  if (query.nodes && query.nodes.length > 0) {
    result = result.filter(item => query.nodes?.includes(item.node || item.knowledge_point));
  }
  if (query.onlyDue) {
    result = result.filter((item) => {
      if (!item.next_review_date) return true;
      const dueTime = new Date(item.next_review_date).getTime();
      return Number.isNaN(dueTime) || dueTime <= now.getTime();
    });
  }
  if (query.onlyUnmastered) {
    result = result.filter(item => (item.mastery_level ?? Math.round((item.confidence ?? 0.5) * 100)) < 80);
  }
  if (query.onlyStubborn) {
    result = result.filter(item => Boolean(item.stubborn_flag));
  }
  if (query.onlyArchived) {
    result = result.filter(item => isQuestionArchived(item));
  } else if (!query.includeArchived) {
    result = result.filter(item => !isQuestionArchived(item));
  }
  if (query.sortBy === 'latestWrong') {
    result = result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } else if (query.sortBy === 'lowestMastery') {
    result = result.sort((a, b) => {
      const left = a.mastery_level ?? Math.round((a.confidence ?? 0.5) * 100);
      const right = b.mastery_level ?? Math.round((b.confidence ?? 0.5) * 100);
      if (left !== right) return left - right;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  } else if (query.sortBy === 'nearestDue') {
    result = result.sort((a, b) => {
      const left = new Date(a.next_review_date || 0).getTime();
      const right = new Date(b.next_review_date || 0).getTime();
      if (left !== right) return left - right;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }
  if (query.offset && query.offset > 0) {
    result = result.slice(query.offset);
  }
  if (query.limit && query.limit > 0) {
    result = result.slice(0, query.limit);
  }
  return result;
}

async function fetchAllQuestionsFromRemote(userId: string) {
  if (isLocalDataApiMode()) {
    const token = await getAccessToken();
    const response = await localDataApiFetch<{ data: Question[] }>(token, '/questions');
    return (response.data || []).map(normalizeQuestionRow);
  }
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(normalizeQuestionRow);
}

function hasQueryCondition(query: QuestionQuery = {}) {
  return Boolean(
    query.subject ||
    query.category ||
    (query.nodes && query.nodes.length > 0) ||
    query.onlyDue ||
    query.onlyUnmastered ||
    query.onlyStubborn ||
    query.includeArchived ||
    query.onlyArchived ||
    query.sortBy ||
    (query.limit && query.limit > 0) ||
    (query.offset && query.offset > 0),
  );
}

function hasPostFilterNeed(query: QuestionQuery = {}) {
  return Boolean(
    query.onlyUnmastered,
  );
}

function buildSupabaseTextInList(values: string[]) {
  return values
    .map((item) => `"${item.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',');
}

async function fetchQuestionsByQueryFromRemote(userId: string, query: QuestionQuery = {}) {
  if (isLocalDataApiMode()) {
    const params = new URLSearchParams();
    if (query.subject) params.set('subject', query.subject);
    if (query.category) params.set('category', query.category);
    
    if (query.nodes && query.nodes.length > 0) params.set('nodes', query.nodes.join(','));
    if (query.onlyDue) params.set('onlyDue', '1');
    if (query.onlyUnmastered) params.set('onlyUnmastered', '1');
    if (query.onlyStubborn) params.set('onlyStubborn', '1');
    if (query.includeArchived) params.set('includeArchived', '1');
    if (query.onlyArchived) params.set('onlyArchived', '1');
    if (query.sortBy) params.set('sortBy', query.sortBy);
    if (query.limit && query.limit > 0) params.set('limit', String(query.limit));
    if (query.offset && query.offset > 0) params.set('offset', String(query.offset));
    const token = await getAccessToken();
    const response = await localDataApiFetch<{ data: Question[] }>(token, `/questions?${params.toString()}`);
    return (response.data || []).map(normalizeQuestionRow);
  }
  let request = supabase
    .from('questions')
    .select('*')
    .eq('user_id', userId);

  if (query.subject) {
    request = request.eq('subject', query.subject);
  }
  if (query.category) {
    request = request.eq('category', query.category);
  }

  if (query.nodes && query.nodes.length > 0) {
    const nodeList = buildSupabaseTextInList(query.nodes);
    request = request.or(`node.in.(${nodeList}),knowledge_point.in.(${nodeList})`);
  }
  if (query.onlyStubborn) {
    request = request.eq('stubborn_flag', true);
  }
  if (query.onlyArchived) {
    request = request.eq('is_archived', true);
  } else if (!query.includeArchived) {
    request = request.eq('is_archived', false);
  }
  if (query.onlyDue) {
    const nowIso = new Date().toISOString();
    request = request.or(`next_review_date.is.null,next_review_date.lte.${nowIso}`);
  }
  if (query.sortBy === 'lowestMastery') {
    request = request.order('mastery_level', { ascending: true, nullsFirst: true });
  } else if (query.sortBy === 'nearestDue') {
    request = request.order('next_review_date', { ascending: true, nullsFirst: true });
  } else {
    request = request.order('created_at', { ascending: false });
  }

  const shouldApplyRange = !hasPostFilterNeed(query) && ((query.limit && query.limit > 0) || (query.offset && query.offset > 0));
  if (shouldApplyRange) {
    const offset = Math.max(0, query.offset || 0);
    if (query.limit && query.limit > 0) {
      request = request.range(offset, offset + query.limit - 1);
    } else {
      request = request.range(offset, offset + 199);
    }
  }

  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return (data || []).map(normalizeQuestionRow);
}

async function probeQuestionsSignature(userId: string) {
  if (isLocalDataApiMode()) {
    const token = await getAccessToken();
    const response = await localDataApiFetch<{ data: { signature: string } }>(token, '/questions/signature');
    return response.data?.signature || '0::';
  }
  const { data, count, error } = await supabase
    .from('questions')
    .select('id, created_at', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const head = (data || [])[0] as { id?: string; created_at?: string } | undefined;
  return `${count || 0}:${head?.id || ''}:${head?.created_at || ''}`;
}

function invalidateQuestionsCache(userId?: string) {
  if (userId) {
    questionsCache.delete(userId);
    void removePersistentCache('questions', getQuestionsCacheKey(userId));
    return;
  }
  questionsCache.clear();
}

function invalidateAggregateQueries() {
  void queryClient.invalidateQueries({ queryKey: ['dashboard', 'stats'] });
  void queryClient.invalidateQueries({ queryKey: ['questions', 'due-count'] });
  void queryClient.invalidateQueries({ queryKey: ['knowledge', 'node-mastery'] });
  void queryClient.invalidateQueries({ queryKey: ['review', 'global-error-stats'] });
}

const DEFAULT_NODE_DOSSIER_LIMIT = 20;

function normalizeNodeDossierSortStrategy(input?: string): NodeDossierSortStrategy {
  switch (String(input || '').trim()) {
    case 'lowest_mastery':
      return 'lowest_mastery';
    case 'recent_edited_desc':
      return 'recent_edited_desc';
    case 'custom_order':
      return 'custom_order';
    case 'due_review_priority':
      return 'due_review_priority';
    default:
      return 'recent_error_desc';
  }
}

function toFiniteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toIsoTimestamp(value: unknown, fallback = '') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const timestamp = new Date(raw).getTime();
  if (Number.isNaN(timestamp)) return fallback;
  return new Date(timestamp).toISOString();
}

function getRecentEditAt(question: Question) {
  const raw = (question as any)?.updated_at || (question as any)?.edited_at || question.created_at;
  return toIsoTimestamp(raw, toIsoTimestamp(question.created_at, new Date(0).toISOString()));
}

function getRecentErrorAt(question: Question) {
  return toIsoTimestamp(question.created_at, new Date(0).toISOString());
}

function getDueAt(question: Question) {
  return toIsoTimestamp(question.next_review_date, '');
}

function clipText(input: unknown, maxLength = 72) {
  const normalized = String(input || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…` : normalized;
}

function uniqueStrings(values: Array<unknown>, limit = 12) {
  return Array.from(new Set(
    values
      .flatMap((item) => Array.isArray(item) ? item : [item])
      .map((item) => String(item || '').trim())
      .filter(Boolean),
  )).slice(0, limit);
}

function parseNotebookSections(markdown: string, nodeId: string) {
  const normalizedMarkdown = String(markdown || '').replace(/\r\n/g, '\n').trim();
  if (!normalizedMarkdown) return [];
  const lines = normalizedMarkdown.split('\n');
  const sections: Array<{ title: string; lines: string[] }> = [];
  let currentTitle = '未分节笔记';
  let currentLines: string[] = [];
  const pushCurrent = () => {
    const content = currentLines.join('\n').trim();
    if (!content && sections.length > 0) return;
    sections.push({
      title: currentTitle,
      lines: content ? content.split('\n') : [],
    });
  };
  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading?.[1]) {
      if (currentLines.length > 0 || sections.length === 0) {
        pushCurrent();
      }
      currentTitle = clipText(heading[1], 40) || '未命名章节';
      currentLines = [line];
      continue;
    }
    currentLines.push(line);
  }
  if (currentLines.length > 0) {
    pushCurrent();
  }
  return sections
    .map((section, index) => {
      const contentMarkdown = section.lines.join('\n').trim();
      return {
        section_id: `${nodeId}::section_${index + 1}`,
        order: index + 1,
        title: section.title,
        content_markdown: contentMarkdown,
        preview: clipText(contentMarkdown.replace(/^#{1,3}\s+/gm, ''), 120),
      };
    })
    .filter((section, index, array) => Boolean(section.content_markdown) || (index === 0 && array.length === 1));
}

function buildQuestionKeywords(question: Question) {
  const payloadKeywords = Array.isArray((question.normalized_payload as any)?.keywords)
    ? ((question.normalized_payload as any)?.keywords as unknown[])
    : [];
  return uniqueStrings([
    question.subject,
    question.knowledge_point,
    question.node,
    question.category,
    question.question_text,
    question.correct_answer,
    question.note,
    question.summary,
    payloadKeywords,
  ], 16);
}

function buildSortMetrics(question: Question, strategy: NodeDossierSortStrategy, displayOrder: number): NodeDossierSortMetric[] {
  const masteryLevel = question.mastery_level ?? Math.round((question.confidence ?? 0.5) * 100);
  const dueAt = getDueAt(question) || null;
  return [
    { key: 'display_order', label: '排序位置', value: displayOrder },
    { key: 'strategy', label: '排序策略', value: strategy },
    { key: 'mastery_level', label: '掌握度', value: masteryLevel },
    { key: 'review_count', label: '复习次数', value: toFiniteNumber(question.review_count) ?? 0 },
    { key: 'recent_error_at', label: '最近出错时间', value: getRecentErrorAt(question) },
    { key: 'recent_edit_at', label: '最近编辑时间', value: getRecentEditAt(question) },
    { key: 'due_at', label: '下次复习时间', value: dueAt },
  ];
}

function buildSortReason(question: Question, strategy: NodeDossierSortStrategy, displayOrder: number) {
  const masteryLevel = question.mastery_level ?? Math.round((question.confidence ?? 0.5) * 100);
  if (strategy === 'lowest_mastery') {
    return `第 ${displayOrder} 位：当前掌握度 ${masteryLevel}，优先暴露薄弱题。`;
  }
  if (strategy === 'recent_edited_desc') {
    return `第 ${displayOrder} 位：最近编辑时间为 ${getRecentEditAt(question)}。`;
  }
  if (strategy === 'custom_order') {
    return `第 ${displayOrder} 位：沿用当前自定义顺序快照。`;
  }
  if (strategy === 'due_review_priority') {
    return getDueAt(question)
      ? `第 ${displayOrder} 位：该题已进入待复习窗口，复习时间 ${getDueAt(question)}。`
      : `第 ${displayOrder} 位：无明确复习时间，按薄弱度与最近错题时间补位。`;
  }
  return `第 ${displayOrder} 位：最近出错时间为 ${getRecentErrorAt(question)}。`;
}

function compareQuestionsByStrategy(left: Question, right: Question, strategy: NodeDossierSortStrategy) {
  const leftMastery = left.mastery_level ?? Math.round((left.confidence ?? 0.5) * 100);
  const rightMastery = right.mastery_level ?? Math.round((right.confidence ?? 0.5) * 100);
  const leftErrorAt = new Date(getRecentErrorAt(left)).getTime();
  const rightErrorAt = new Date(getRecentErrorAt(right)).getTime();
  const leftEditAt = new Date(getRecentEditAt(left)).getTime();
  const rightEditAt = new Date(getRecentEditAt(right)).getTime();
  const leftDueAt = new Date(getDueAt(left) || '9999-12-31T00:00:00.000Z').getTime();
  const rightDueAt = new Date(getDueAt(right) || '9999-12-31T00:00:00.000Z').getTime();
  const leftCustomOrder = toFiniteNumber((left as any)?.display_order ?? (left as any)?.sort_order ?? (left as any)?.custom_order) ?? Number.MAX_SAFE_INTEGER;
  const rightCustomOrder = toFiniteNumber((right as any)?.display_order ?? (right as any)?.sort_order ?? (right as any)?.custom_order) ?? Number.MAX_SAFE_INTEGER;
  if (strategy === 'lowest_mastery') {
    if (leftMastery !== rightMastery) return leftMastery - rightMastery;
    return rightErrorAt - leftErrorAt;
  }
  if (strategy === 'recent_edited_desc') {
    if (leftEditAt !== rightEditAt) return rightEditAt - leftEditAt;
    return rightErrorAt - leftErrorAt;
  }
  if (strategy === 'custom_order') {
    if (leftCustomOrder !== rightCustomOrder) return leftCustomOrder - rightCustomOrder;
    return rightErrorAt - leftErrorAt;
  }
  if (strategy === 'due_review_priority') {
    if (leftDueAt !== rightDueAt) return leftDueAt - rightDueAt;
    if (leftMastery !== rightMastery) return leftMastery - rightMastery;
    return rightErrorAt - leftErrorAt;
  }
  return rightErrorAt - leftErrorAt;
}

function normalizeScopeKey(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

function deriveNodeNotebook(
  learningState: UserLearningStateRecord,
  params: {
    tagId: string;
    nodeId: string;
    tagName: string;
    nodeName: string;
  },
  fallbackMarkdown?: string,
) {
  const drawerByTag = learningState.learning_content?.drawerByTag || {};
  const scopeKeys = [
    params.nodeId,
    params.nodeName,
    params.tagId,
    params.tagName,
  ].map((item) => String(item || '').trim()).filter(Boolean);
  const normalizedScopeKeys = scopeKeys.map((item) => normalizeScopeKey(item)).filter(Boolean);
  let sourceKey = scopeKeys.find((item) => drawerByTag[item]) || '';
  if (!sourceKey && normalizedScopeKeys.length > 0) {
    for (const [key, value] of Object.entries(drawerByTag)) {
      const normalizedKey = normalizeScopeKey(key);
      const normalizedTitle = normalizeScopeKey((value as any)?.title);
      if (normalizedScopeKeys.includes(normalizedKey) || (normalizedTitle && normalizedScopeKeys.includes(normalizedTitle))) {
        sourceKey = key;
        break;
      }
    }
  }
  const drawer = sourceKey ? drawerByTag[sourceKey] : undefined;
  const contentMarkdown = String(drawer?.markdown || fallbackMarkdown || '').trim();
  const summary = clipText(drawer?.summary || contentMarkdown, 160);
  return {
    node_id: params.nodeId,
    tag_id: params.tagId,
    title: String(drawer?.title || params.nodeName || params.tagName || '知识点笔记').trim(),
    summary,
    content_markdown: contentMarkdown,
    source_key: sourceKey || scopeKeys[0] || params.nodeId || params.nodeName || params.tagId || params.tagName,
    sections: parseNotebookSections(contentMarkdown, params.nodeId),
  };
}

function buildSnapshotVersion(parts: Array<unknown>) {
  return `node-${parts.map((item) => String(item || '').trim()).join('--')}`;
}

async function resolveNodeScope(query: NodeDossierQuery | NodeMistakeLookupQuery) {
  const questions = await questionsApi.getAll({ includeArchived: true });
  const requestedTagId = String(query.tagId || '').trim();
  const requestedNodeId = String(query.nodeId || '').trim();
  const activeIds = uniqueStrings([
    query.activeMistakeId,
    query.activeMistakeIds || [],
    (query as NodeMistakeLookupQuery).mistakeId,
  ], 20);
  const activePool = activeIds.length > 0
    ? questions.filter((question) => activeIds.includes(resolveCanonicalMistakeId(question)))
    : [];
  const strictPool = questions.filter((question) => {
    const tagId = resolveCanonicalTagId(question);
    const nodeId = resolveCanonicalNodeId(question);
    if (query.tagId && tagId !== query.tagId) return false;
    if (query.nodeId && nodeId !== query.nodeId) return false;
    return true;
  });
  const tagOnlyPool = requestedTagId
    ? questions.filter((question) => resolveCanonicalTagId(question) === requestedTagId)
    : [];
  const nodeOnlyPool = requestedNodeId
    ? questions.filter((question) => resolveCanonicalNodeId(question) === requestedNodeId)
    : [];
  const candidatePool = requestedTagId
    ? (strictPool.length > 0 ? strictPool : tagOnlyPool)
    : strictPool.length > 0
      ? strictPool
      : nodeOnlyPool.length > 0
        ? nodeOnlyPool
        : tagOnlyPool;
  const workingPool = candidatePool.length > 0 ? candidatePool : activePool;
  const firstQuestion = activePool[0] || workingPool[0] || questions[0] || null;
  const inferredTagId = requestedTagId || String(resolveCanonicalTagId(firstQuestion) || '').trim();
  const inferredNodeId = requestedNodeId || String(resolveCanonicalNodeId(firstQuestion) || '').trim();
  let scopedQuestions = questions.filter((question) => {
    if (inferredTagId && resolveCanonicalTagId(question) !== inferredTagId) return false;
    if (inferredNodeId && resolveCanonicalNodeId(question) !== inferredNodeId) return false;
    return true;
  });
  if (scopedQuestions.length === 0 && !requestedTagId) {
    const fallbackTagName = String((firstQuestion as any)?.category || (firstQuestion as any)?.tag_name || '').trim();
    const fallbackNodeName = String((firstQuestion as any)?.node || (firstQuestion as any)?.knowledge_point || (firstQuestion as any)?.name || '').trim();
    const normalizedFallbackTag = normalizeScopeKey(fallbackTagName);
    const normalizedFallbackNode = normalizeScopeKey(fallbackNodeName);
    if (normalizedFallbackNode) {
      scopedQuestions = questions.filter((question) => {
        const questionTagName = String((question as any)?.category || (question as any)?.tag_name || '').trim();
        const questionNodeName = String((question as any)?.node || (question as any)?.knowledge_point || (question as any)?.name || '').trim();
        if (normalizedFallbackTag && normalizeScopeKey(questionTagName) !== normalizedFallbackTag) return false;
        return normalizeScopeKey(questionNodeName) === normalizedFallbackNode;
      });
    }
  }
  const scopeSeed = scopedQuestions[0] || firstQuestion || {};
  return {
    questions,
    scopedQuestions,
    tagId: inferredTagId,
    nodeId: inferredNodeId,
    tagName: String((scopeSeed as any)?.category || (scopeSeed as any)?.tag_name || (scopeSeed as any)?.knowledge_point || '').trim(),
    nodeName: String((scopeSeed as any)?.node || (scopeSeed as any)?.knowledge_point || (scopeSeed as any)?.name || '').trim(),
  };
}

let knowledgeNodeTipsCache: { updatedAt: number; rows: Array<{ subject: string; category: string; branch?: string; node: string; tips_and_tricks: string }> } = {
  updatedAt: 0,
  rows: [],
};

async function getKnowledgeNodeTipsByScope(scope: { tagName: string; nodeName: string; questions: Question[] }) {
  const now = Date.now();
  if (now - knowledgeNodeTipsCache.updatedAt > 30_000 || knowledgeNodeTipsCache.rows.length === 0) {
    const rows = await knowledgeNodesApi.getAll().catch(() => []);
    knowledgeNodeTipsCache = { updatedAt: now, rows: Array.isArray(rows) ? rows : [] };
  }
  const subjectHint = String(scope.questions[0]?.subject || '').trim();
  const tagHint = normalizeScopeKey(scope.tagName);
  const nodeHint = normalizeScopeKey(scope.nodeName);
  const matched = knowledgeNodeTipsCache.rows.find((row) => {
    if (subjectHint && String(row.subject || '').trim() !== subjectHint) return false;
    if (nodeHint && normalizeScopeKey(row.node) !== nodeHint) return false;
    if (tagHint && normalizeScopeKey(row.category) !== tagHint) return false;
    return true;
  });
  return String(matched?.tips_and_tricks || '').trim();
}

function buildNodeMistakeIndexEntry(
  question: Question,
  strategy: NodeDossierSortStrategy,
  displayOrder: number,
): NodeMistakeIndexEntry {
  const masteryLevel = question.mastery_level ?? Math.round((question.confidence ?? 0.5) * 100);
  return {
    mistake_id: resolveCanonicalMistakeId(question),
    tag_id: resolveCanonicalTagId(question),
    node_id: resolveCanonicalNodeId(question),
    id_path: question.id_path,
    display_order: displayOrder,
    sort_position: displayOrder,
    sort_strategy: strategy,
    sort_reason: buildSortReason(question, strategy, displayOrder),
    title_excerpt: clipText(question.question_text, 96),
    answer_excerpt: clipText(question.correct_answer || getStemFromPayload(question.normalized_payload), 80),
    mistake_excerpt: clipText(question.note || question.summary, 80),
    mastery_level: masteryLevel,
    recent_error_at: getRecentErrorAt(question),
    recent_edit_at: getRecentEditAt(question),
    due_at: getDueAt(question) || null,
    keywords: buildQuestionKeywords(question),
    metrics: buildSortMetrics(question, strategy, displayOrder),
  };
}

function rankNodeQuestions(questions: Question[], strategy: NodeDossierSortStrategy) {
  return [...questions]
    .sort((left, right) => compareQuestionsByStrategy(left, right, strategy))
    .map((question, index) => ({
      question,
      entry: buildNodeMistakeIndexEntry(question, strategy, index + 1),
    }));
}

function filterRankedNodeQuestions(
  rankedQuestions: Array<{ question: Question; entry: NodeMistakeIndexEntry }>,
  query: NodeMistakeLookupQuery,
) {
  const keyword = String(query.keyword || '').trim().toLowerCase();
  const mistakeId = String(query.mistakeId || '').trim();
  const createdAfter = query.createdAfter ? new Date(query.createdAfter).getTime() : Number.NEGATIVE_INFINITY;
  const createdBefore = query.createdBefore ? new Date(query.createdBefore).getTime() : Number.POSITIVE_INFINITY;
  const dueAfter = query.dueAfter ? new Date(query.dueAfter).getTime() : Number.NEGATIVE_INFINITY;
  const dueBefore = query.dueBefore ? new Date(query.dueBefore).getTime() : Number.POSITIVE_INFINITY;
  return rankedQuestions.filter(({ question, entry }) => {
    if (mistakeId && entry.mistake_id !== mistakeId) return false;
    if (keyword) {
      const haystack = [
        entry.title_excerpt,
        entry.answer_excerpt,
        entry.mistake_excerpt,
        entry.keywords.join(' '),
      ].join(' ').toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    const createdAt = new Date(entry.recent_error_at).getTime();
    if (createdAt < createdAfter || createdAt > createdBefore) return false;
    const dueAt = entry.due_at ? new Date(entry.due_at).getTime() : Number.NaN;
    if (!Number.isNaN(dueAt) && (dueAt < dueAfter || dueAt > dueBefore)) return false;
    if ((query.offset || 0) > 0 && entry.sort_position <= Number(query.offset || 0)) {
      return true;
    }
    return true;
  });
}

export const nodeDossierApi = {
  getNodeDossier: async (query: NodeDossierQuery = {}): Promise<NodeDossier> => {
    const scope = await resolveNodeScope(query);
    const strategy = normalizeNodeDossierSortStrategy(query.sortBy);
    const ranking = rankNodeQuestions(scope.scopedQuestions, strategy);
    const offset = Math.max(0, Number(query.offset || 0));
    const limit = Math.max(1, Number(query.limit || DEFAULT_NODE_DOSSIER_LIMIT));
    const visibleRanking = ranking.slice(offset, offset + limit);
    const learningState = await userLearningStateApi.get();
    const knowledgeNodeTips = await getKnowledgeNodeTipsByScope(scope);
    const notebook = deriveNodeNotebook(learningState, {
      tagId: scope.tagId,
      nodeId: scope.nodeId,
      tagName: scope.tagName,
      nodeName: scope.nodeName,
    }, knowledgeNodeTips);
    const averageMastery = scope.scopedQuestions.length > 0
      ? Math.round(scope.scopedQuestions.reduce((sum, item) => sum + (item.mastery_level ?? Math.round((item.confidence ?? 0.5) * 100)), 0) / scope.scopedQuestions.length)
      : null;
    const activeIds = uniqueStrings([query.activeMistakeId, query.activeMistakeIds || []], 20);
    const activeMistakes = activeIds.length > 0
      ? scope.scopedQuestions.filter((question) => activeIds.includes(resolveCanonicalMistakeId(question)))
      : [];
    const snapshotVersion = buildSnapshotVersion([
      scope.tagId,
      scope.nodeId,
      strategy,
      scope.scopedQuestions.length,
      ranking[0]?.entry?.mistake_id || 'empty',
      ranking[0]?.entry?.recent_edit_at || new Date(0).toISOString(),
      learningState.updated_at || '',
    ]);
    return {
      snapshot_version: snapshotVersion,
      scope: {
        surface: query.surface || 'question_bank',
        tag_id: scope.tagId,
        node_id: scope.nodeId,
        tag_name: scope.tagName,
        node_name: scope.nodeName,
      },
      summary: {
        mistake_count: scope.scopedQuestions.length,
        visible_count: visibleRanking.length,
        due_count: scope.scopedQuestions.filter((question) => {
          const dueAt = getDueAt(question);
          return Boolean(dueAt) && new Date(dueAt).getTime() <= Date.now();
        }).length,
        average_mastery_level: averageMastery,
        sort_strategy: strategy,
      },
      relation_graph: {
        tag_id: scope.tagId,
        node_id: scope.nodeId,
        mistake_ids: ranking.map((item) => item.entry.mistake_id),
        mistake_count: scope.scopedQuestions.length,
      },
      pagination: {
        total: ranking.length,
        offset,
        limit,
        has_more: offset + visibleRanking.length < ranking.length,
        next_offset: offset + visibleRanking.length < ranking.length ? offset + visibleRanking.length : null,
      },
      mistake_index: visibleRanking.map((item) => item.entry),
      active_mistake_id: activeMistakes[0] ? resolveCanonicalMistakeId(activeMistakes[0]) : null,
      active_mistake_ids: activeMistakes.map((item) => resolveCanonicalMistakeId(item)),
      active_mistake: activeMistakes[0] || null,
      active_mistakes: activeMistakes,
      node_notebook: notebook,
    };
  },
  exportNodeDossierFile: async (query: NodeDossierQuery = {}): Promise<NodeDossierFileExport> => {
    const dossier = await nodeDossierApi.getNodeDossier(query);
    return {
      file_name: `${dossier.scope.tag_id || 'tag'}__${dossier.scope.node_id || 'node'}__${dossier.snapshot_version}.json`,
      content_type: 'application/json',
      content: JSON.stringify(dossier, null, 2),
      snapshot_version: dossier.snapshot_version,
    };
  },
  listNodeMistakes: async (query: NodeDossierQuery = {}) => {
    const dossier = await nodeDossierApi.getNodeDossier(query);
    return {
      snapshot_version: dossier.snapshot_version,
      scope: dossier.scope,
      pagination: dossier.pagination,
      entries: dossier.mistake_index,
    };
  },
  searchNodeMistakes: async (query: NodeMistakeLookupQuery = {}) => {
    const scope = await resolveNodeScope(query);
    const strategy = normalizeNodeDossierSortStrategy(query.sortBy);
    const ranking = rankNodeQuestions(scope.scopedQuestions, strategy);
    const filtered = filterRankedNodeQuestions(ranking, query);
    const offset = Math.max(0, Number(query.offset || 0));
    const limit = Math.max(1, Number(query.limit || DEFAULT_NODE_DOSSIER_LIMIT));
    const visible = filtered.slice(offset, offset + limit);
    const snapshotVersion = buildSnapshotVersion([
      scope.tagId,
      scope.nodeId,
      strategy,
      filtered.length,
      visible[0]?.entry?.mistake_id || 'empty',
    ]);
    return {
      snapshot_version: snapshotVersion,
      scope: {
        tag_id: scope.tagId,
        node_id: scope.nodeId,
        tag_name: scope.tagName,
        node_name: scope.nodeName,
      },
      pagination: {
        total: filtered.length,
        offset,
        limit,
        has_more: offset + visible.length < filtered.length,
        next_offset: offset + visible.length < filtered.length ? offset + visible.length : null,
      },
      entries: visible.map((item) => item.entry),
    };
  },
  getMistakeAtPosition: async (query: NodeDossierQuery & { position: number }) => {
    const scope = await resolveNodeScope(query);
    const strategy = normalizeNodeDossierSortStrategy(query.sortBy);
    const ranking = rankNodeQuestions(scope.scopedQuestions, strategy);
    const matched = ranking[Math.max(0, Number(query.position || 1) - 1)] || null;
    return matched ? {
      snapshot_version: buildSnapshotVersion([scope.tagId, scope.nodeId, strategy, matched.entry.mistake_id, matched.entry.sort_position]),
      scope: {
        tag_id: scope.tagId,
        node_id: scope.nodeId,
        tag_name: scope.tagName,
        node_name: scope.nodeName,
      },
      entry: matched.entry,
      detail: matched.question,
    } : null;
  },
  compareMistakes: async (query: NodeDossierQuery & { mistakeIds: string[] }) => {
    const scope = await resolveNodeScope(query);
    const strategy = normalizeNodeDossierSortStrategy(query.sortBy);
    const ranking = rankNodeQuestions(scope.scopedQuestions, strategy);
    const requested = uniqueStrings(query.mistakeIds || [], 20);
    const matched = ranking.filter((item) => requested.includes(item.entry.mistake_id));
    return {
      snapshot_version: buildSnapshotVersion([scope.tagId, scope.nodeId, strategy, matched.length]),
      scope: {
        tag_id: scope.tagId,
        node_id: scope.nodeId,
        tag_name: scope.tagName,
        node_name: scope.nodeName,
      },
      entries: matched.map((item) => item.entry),
      details: matched.map((item) => item.question),
    };
  },
};

// ---- Questions ----
export const questionsApi = {
  getAll: async (query: QuestionQuery = {}, options?: { forceRefresh?: boolean }): Promise<Question[]> => {
    const authResult = await supabase.auth.getSession();
    const user = authResult?.data?.session?.user;
    if (!user) throw new Error('未登录');
    const startedAt = Date.now();
    const storageKey = getQuestionsCacheKey(user.id);
    const inMemory = questionsCache.get(user.id);
    const persisted = inMemory || await readPersistentCache<Question[]>('questions', storageKey);
    if (persisted) {
      questionsCache.set(user.id, persisted);
      if (!options?.forceRefresh && isCacheFresh(persisted.timestamp, QUESTIONS_CACHE_TTL_MS)) {
        trackCacheEvent('cache_questions_hit', startedAt);
        return applyQuestionQuery(persisted.value, query);
      }
      try {
        const remoteSignature = await probeQuestionsSignature(user.id);
        if (persisted.signature && persisted.signature === remoteSignature) {
          const refreshed: CacheEntry<Question[]> = {
            ...persisted,
            timestamp: Date.now(),
          };
          questionsCache.set(user.id, refreshed);
          await writePersistentCache('questions', storageKey, refreshed);
          trackCacheEvent('cache_questions_revalidate_skip', startedAt);
          return applyQuestionQuery(refreshed.value, query);
        }
      } catch {
      }
    }
    const result = await fetchAllQuestionsFromRemote(user.id);
    const entry: CacheEntry<Question[]> = {
      value: result,
      timestamp: Date.now(),
      signature: buildQuestionsSignature(result),
    };
    questionsCache.set(user.id, entry);
    await writePersistentCache('questions', storageKey, entry);
    trackCacheEvent('cache_questions_miss', startedAt);
    return applyQuestionQuery(result, query);
  },

  getCached: async (query: QuestionQuery = {}): Promise<Question[] | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return null;
    const inMemory = questionsCache.get(user.id);
    const persisted = inMemory || await readPersistentCache<Question[]>('questions', getQuestionsCacheKey(user.id));
    if (!persisted) return null;
    if (!inMemory) {
      questionsCache.set(user.id, persisted);
    }
    return applyQuestionQuery(persisted.value, query);
  },

  getRevision: async (): Promise<string> => {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) throw new Error('未登录');
    return probeQuestionsSignature(user.id);
  },

  count: async (query: QuestionQuery = {}): Promise<number> => {
    const list = await questionsApi.getAll({
      ...query,
      limit: undefined,
      offset: undefined,
    });
    return list.length;
  },

  countDue: async (query: Pick<QuestionQuery, 'subject'> = {}): Promise<number> => {
    const list = await questionsApi.getAll({
      ...query,
      onlyDue: true,
      includeArchived: false,
      limit: undefined,
      offset: undefined,
    });
    return list.length;
  },

  create: async (q: Partial<Question>): Promise<Question> => {
    const authResult = await supabase.auth.getUser();
    const user = authResult?.data?.user;
    if (!user) throw new Error('未登录');
    const canonicalTags = await normalizeQuestionTagsForWrite({
      subject: q.subject,
      knowledgePoint: q.knowledge_point,
    });
    const normalized = normalizeQuestionPayload({
      ...(q as Partial<Question> & { options?: string[] }),
      subject: canonicalTags.subject,
      knowledge_point: canonicalTags.knowledgePoint,
    });
    const masteryState = normalizeMasteryStateForInsert(normalized.mastery_state);
    const fullInsertPayload = {
      p_subject: normalized.subject,
      p_question_text: normalized.question_text,
      p_category: normalized.category,
      p_node: normalized.node,
      p_image_url: normalized.image_url,
      p_knowledge_point: normalized.knowledge_point,
      p_question_type: normalized.question_type,
      p_correct_answer: normalized.correct_answer,
      p_raw_ai_response: normalized.raw_ai_response,
      p_normalized_payload: normalized.normalized_payload,
      p_payload_version: normalized.payload_version,
      p_validation_status: normalized.validation_status,
      p_render_mode: normalized.render_mode,
      p_note: normalized.note,
      p_summary: normalized.summary,
      p_confidence: normalized.confidence,
      p_mastery_level: normalized.mastery_level,
      p_next_review_date: normalized.next_review_date,
      p_stubborn_flag: normalized.stubborn_flag,
      p_review_count: normalized.review_count || 0,
    };

    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      const response = await localDataApiFetch<{ data: Question }>(token, '/questions', {
        method: 'POST',
        body: JSON.stringify({
          subject: normalized.subject,
          question_text: normalized.question_text,
          category: normalized.category,
          node: normalized.node,
          image_url: normalized.image_url,
          knowledge_point: normalized.knowledge_point,
          question_type: normalized.question_type,
          correct_answer: normalized.correct_answer,
          raw_ai_response: normalized.raw_ai_response,
          normalized_payload: normalized.normalized_payload,
          payload_version: normalized.payload_version,
          validation_status: normalized.validation_status,
          render_mode: normalized.render_mode,
          note: normalized.note,
          summary: normalized.summary,
          confidence: normalized.confidence,
          mastery_level: normalized.mastery_level,
          next_review_date: normalized.next_review_date,
          stubborn_flag: normalized.stubborn_flag,
          mastery_state: masteryState,
          mastered_at: normalized.mastered_at,
          is_archived: normalized.is_archived,
          archived_at: normalized.archived_at,
          review_count: normalized.review_count || 0,
        }),
      });
      invalidateQuestionsCache(user.id);
      statsApi.invalidateCache(user.id);
      invalidateAggregateQueries();
      return normalizeQuestionRow(response.data);
    }
    
    const directPayload = {
      user_id: user.id,
      subject: normalized.subject,
      question_text: normalized.question_text,
      category: normalized.category,
      node: normalized.node,
      image_url: normalized.image_url,
      knowledge_point: normalized.knowledge_point,
      question_type: normalized.question_type,
      correct_answer: normalized.correct_answer,
      raw_ai_response: normalized.raw_ai_response,
      normalized_payload: normalized.normalized_payload,
      payload_version: normalized.payload_version,
      validation_status: normalized.validation_status,
      render_mode: normalized.render_mode,
      note: normalized.note,
      summary: normalized.summary,
      confidence: normalized.confidence,
      mastery_level: normalized.mastery_level,
      next_review_date: normalized.next_review_date,
      stubborn_flag: normalized.stubborn_flag,
      mastery_state: masteryState,
      mastered_at: normalized.mastered_at,
      is_archived: normalized.is_archived,
      archived_at: normalized.archived_at,
      review_count: normalized.review_count || 0,
    };

    let insertResult = await supabase.from('questions').insert(directPayload).select().single();
    if (insertResult.error && isMissingColumnError(insertResult.error) && isLegacyDbFallbackEnabled()) {
      const legacyInsertPayload = { ...directPayload };
      delete (legacyInsertPayload as any).question_type;
      delete (legacyInsertPayload as any).correct_answer;
      delete (legacyInsertPayload as any).raw_ai_response;
      delete (legacyInsertPayload as any).normalized_payload;
      delete (legacyInsertPayload as any).payload_version;
      delete (legacyInsertPayload as any).validation_status;
      delete (legacyInsertPayload as any).render_mode;
      insertResult = await supabase.from('questions').insert(legacyInsertPayload).select().single();
    }

    let insertedData = insertResult.data;
    let usedDirectInsert = !insertResult.error && Boolean(insertResult.data);

    if (insertResult.error || !insertedData) {
      const rpcResult = await supabase.rpc('create_question', fullInsertPayload).select().maybeSingle();
      if (rpcResult.error) throw new Error(rpcResult.error.message);
      if (!rpcResult.data) throw new Error('入库失败：创建错题未返回数据');
      insertedData = rpcResult.data;
      usedDirectInsert = false;
    }

    if (usedDirectInsert && normalized.knowledge_point) {
      await weaknessApi.incrementError(normalized.knowledge_point);
    }
    
    invalidateQuestionsCache(user.id);
    statsApi.invalidateCache(user.id);
    invalidateAggregateQueries();
    return normalizeQuestionRow(insertedData);
  },

  update: async (id: string, updates: Partial<Question>): Promise<Question> => {
    const authResult = await supabase.auth.getUser();
    const user = authResult?.data?.user;
    if (!user) throw new Error('未登录');
    const targetRowId = await resolveStoredQuestionRowId(id);
    const normalized = (updates.question_text !== undefined || updates.correct_answer !== undefined || updates.question_type !== undefined)
      ? normalizeQuestionPayload(updates as Partial<Question> & { options?: string[] })
      : updates;
    const sanitizedUpdates = sanitizeMasteryStateForUpdate(normalized);
    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      const response = await localDataApiFetch<{ data: Question }>(token, '/questions/update', {
        method: 'POST',
        body: JSON.stringify({
          id: targetRowId,
          updates: sanitizedUpdates,
        }),
      });
      invalidateQuestionsCache(user.id);
      statsApi.invalidateCache(user.id);
      invalidateAggregateQueries();
      return normalizeQuestionRow(response.data);
    }
    let effectiveUpdates = sanitizedUpdates;
    let updateResult = await supabase
      .from('questions')
      .update(effectiveUpdates)
      .eq('id', targetRowId)
      .select()
      .maybeSingle();
    if (updateResult.error && isMissingColumnError(updateResult.error) && isLegacyDbFallbackEnabled()) {
      const legacyUpdates = { ...updates };
      delete (legacyUpdates as any).question_type;
      delete (legacyUpdates as any).correct_answer;
      delete (legacyUpdates as any).raw_ai_response;
      delete (legacyUpdates as any).normalized_payload;
      delete (legacyUpdates as any).payload_version;
      delete (legacyUpdates as any).validation_status;
      delete (legacyUpdates as any).render_mode;
      delete (legacyUpdates as any).mastery_level;
      delete (legacyUpdates as any).confidence;
      delete (legacyUpdates as any).next_review_date;
      delete (legacyUpdates as any).stubborn_flag;
      delete (legacyUpdates as any).mastery_state;
      delete (legacyUpdates as any).mastered_at;
      delete (legacyUpdates as any).is_archived;
      delete (legacyUpdates as any).archived_at;
      delete (legacyUpdates as any).review_count;
      effectiveUpdates = legacyUpdates;
      updateResult = await supabase
        .from('questions')
        .update(effectiveUpdates)
        .eq('id', targetRowId)
        .select()
        .maybeSingle();
    }
    if (updateResult.error) throw new Error(updateResult.error.message);
    if (updateResult.data) {
      invalidateQuestionsCache(user.id);
      statsApi.invalidateCache(user.id);
      invalidateAggregateQueries();
      return normalizeQuestionRow(updateResult.data);
    }
    const refetch = await supabase
      .from('questions')
      .select('*')
      .eq('id', targetRowId)
      .maybeSingle();
    if (refetch.error) throw new Error(refetch.error.message);
    if (refetch.data) {
      invalidateQuestionsCache(user.id);
      statsApi.invalidateCache(user.id);
      invalidateAggregateQueries();
      return normalizeQuestionRow(refetch.data);
    }
    invalidateQuestionsCache(user.id);
    statsApi.invalidateCache(user.id);
    invalidateAggregateQueries();
    return normalizeQuestionRow({
      id: targetRowId,
      ...effectiveUpdates,
    });
  },

  batchUpdate: async (ids: string[], updates: Partial<Question>): Promise<number> => {
    if (!ids || ids.length === 0) return 0;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    const resolvedIds = (await Promise.all(ids.map((id) => resolveStoredQuestionRowId(id)))).filter(Boolean);
    if (resolvedIds.length === 0) return 0;
    const normalized = (updates.question_text !== undefined || updates.correct_answer !== undefined || updates.question_type !== undefined)
      ? normalizeQuestionPayload(updates as Partial<Question> & { options?: string[] })
      : updates;
    const sanitizedUpdates = sanitizeMasteryStateForUpdate(normalized);
    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      const response = await localDataApiFetch<{ data: { updated: number } }>(token, '/questions/batch-update', {
        method: 'POST',
        body: JSON.stringify({
          ids: resolvedIds,
          updates: sanitizedUpdates,
        }),
      });
      invalidateQuestionsCache(user.id);
      statsApi.invalidateCache(user.id);
      invalidateAggregateQueries();
      return Number(response.data?.updated || 0);
    }
    let effectiveUpdates = sanitizedUpdates;
    let updateResult = await supabase
      .from('questions')
      .update(effectiveUpdates)
      .eq('user_id', user.id)
      .in('id', resolvedIds)
      .select('id');
    if (updateResult.error && isMissingColumnError(updateResult.error) && isLegacyDbFallbackEnabled()) {
      const legacyUpdates = { ...updates };
      delete (legacyUpdates as any).question_type;
      delete (legacyUpdates as any).correct_answer;
      delete (legacyUpdates as any).raw_ai_response;
      delete (legacyUpdates as any).normalized_payload;
      delete (legacyUpdates as any).payload_version;
      delete (legacyUpdates as any).validation_status;
      delete (legacyUpdates as any).render_mode;
      delete (legacyUpdates as any).mastery_level;
      delete (legacyUpdates as any).confidence;
      delete (legacyUpdates as any).next_review_date;
      delete (legacyUpdates as any).stubborn_flag;
      delete (legacyUpdates as any).mastery_state;
      delete (legacyUpdates as any).mastered_at;
      delete (legacyUpdates as any).is_archived;
      delete (legacyUpdates as any).archived_at;
      delete (legacyUpdates as any).review_count;
      effectiveUpdates = legacyUpdates;
      updateResult = await supabase
        .from('questions')
        .update(effectiveUpdates)
        .eq('user_id', user.id)
        .in('id', resolvedIds)
        .select('id');
    }
    if (updateResult.error) throw new Error(updateResult.error.message);
    invalidateQuestionsCache(user.id);
    statsApi.invalidateCache(user.id);
    invalidateAggregateQueries();
    return updateResult.data?.length || 0;
  },

  delete: async (id: string): Promise<void> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    const targetRowId = await resolveStoredQuestionRowId(id);
    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      await localDataApiFetch<{ data: { ok: true } }>(token, '/questions/delete', {
        method: 'POST',
        body: JSON.stringify({ id: targetRowId }),
      });
      invalidateQuestionsCache(user.id);
      statsApi.invalidateCache(user.id);
      invalidateAggregateQueries();
      return;
    }
    const { error } = await supabase
      .from('questions')
      .delete()
      .eq('id', targetRowId);

    if (error) throw new Error(error.message);
    invalidateQuestionsCache(user.id);
    statsApi.invalidateCache(user.id);
    invalidateAggregateQueries();
  },

  add: async (q: Partial<Question>): Promise<Question> => {
    return questionsApi.create(q);
  },
  archive: async (id: string): Promise<Question> => {
    return questionsApi.update(id, {
      mastery_state: 'archived',
      is_archived: true,
      archived_at: new Date().toISOString(),
      next_review_date: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString(),
      stubborn_flag: false,
    });
  },
  unarchive: async (id: string): Promise<Question> => {
    return questionsApi.update(id, {
      mastery_state: 'mastered',
      is_archived: false,
      mastered_at: new Date().toISOString(),
      next_review_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    });
  },
  invalidateCache: (userId?: string) => {
    invalidateQuestionsCache(userId);
  },
  checkSemanticDuplicate: async (pairs: SemanticDuplicatePairInput[]): Promise<SemanticDuplicatePairResult[]> => {
    const normalizedPairs = (Array.isArray(pairs) ? pairs : [])
      .map((pair) => ({
        existingQuestionText: String(pair?.existingQuestionText || '').trim(),
        incomingQuestionText: String(pair?.incomingQuestionText || '').trim(),
      }))
      .filter((pair) => pair.existingQuestionText.length > 0 && pair.incomingQuestionText.length > 0);
    if (normalizedPairs.length === 0) return [];

    const promptPayload = normalizedPairs.map((pair, index) => ({
      index,
      question_a: pair.existingQuestionText.slice(0, 1800),
      question_b: pair.incomingQuestionText.slice(0, 1800),
    }));
    const userPrompt = [
      '请判断以下题目对是否语义重复。',
      '你必须返回 JSON 数组，禁止任何 Markdown 或多余说明。',
      '数组每项必须是：{ "index": number, "is_duplicate": boolean, "confidence": number, "reason": string }。',
      'confidence 范围 0~1，reason 不超过 50 字。',
      JSON.stringify(promptPayload),
    ].join('\n');

    let fullContent = '';
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('AI语义查重超时，请重试')), 45000);
      chatApi.streamChat(
        [{ role: 'user', content: userPrompt }],
        () => {},
        (content) => {
          clearTimeout(timer);
          fullContent = content;
          resolve();
        },
        (err) => {
          clearTimeout(timer);
          reject(new Error(err));
        },
        {
          systemPrompt: '你是严谨的题目语义查重助手。只输出合法 JSON 数组，不输出任何其他文本。',
        }
      );
    });

    const jsonText = extractJsonArrayText(fullContent);
    if (!jsonText) {
      throw new Error('AI语义查重返回格式错误');
    }
    const parsed = JSON.parse(sanitizeJsonText(jsonText));
    const rawList = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.results) ? parsed.results : []);
    const resultMap = new Map<number, SemanticDuplicatePairResult>();
    for (const row of rawList) {
      const index = Number((row as any)?.index);
      if (!Number.isFinite(index) || index < 0) continue;
      const rawConfidence = Number((row as any)?.confidence);
      const confidence = Number.isFinite(rawConfidence)
        ? (rawConfidence > 1 ? Math.min(rawConfidence / 100, 1) : Math.max(rawConfidence, 0))
        : 0;
      resultMap.set(index, {
        is_duplicate: Boolean((row as any)?.is_duplicate),
        confidence,
        reason: String((row as any)?.reason || '').trim(),
      });
    }
    return normalizedPairs.map((_, index) => resultMap.get(index) || {
      is_duplicate: false,
      confidence: 0,
      reason: '',
    });
  },

  generateVariants: async (
    subject: Subject,
    nodes: string[],
    amount: number,
    strategy: '递进' | '随机' | '攻坚',
  ): Promise<{ variants: VariantQuestion[] }> => {
    const request: GovernedGenerationRequest = {
      proposalId: `legacy-${subject}-${strategy}-${amount}`,
      subject,
      nodes,
      amount,
      strategy,
      sourceSurface: 'manual',
      sourceReason: '兼容旧版生成入口',
      objectiveCode: 'custom_scope',
      explanationSummary: '兼容旧版专项练习出题请求',
      successCriteria: `完成 ${amount} 题专项训练`,
      generationPolicy: {
        allowAiGenerate: true,
        allowCache: false,
        allowRuleFallback: false,
      },
    };
    const prompt = buildGenerationPrompt(request, amount);

    let lastError: any;
    for (let attempt = 0; attempt < 2; attempt++) {
      let fullContent = '';
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('AI响应超时，请重试'));
          }, 30000);
          chatApi.streamChat(
            [{ role: 'user', content: prompt }],
            () => {},
            (content) => {
              clearTimeout(timer);
              fullContent = content;
              resolve();
            },
            (err) => {
              clearTimeout(timer);
              reject(new Error(err));
            },
            {
              systemPrompt: '你是一个专业的出题AI。你必须严格按照用户要求的JSON格式输出，不包含任何额外说明。'
            }
          );
        });
        const parsed = parseGeneratedList(fullContent);
        const variants = normalizeGeneratedVariants(parsed, subject, 'ai');
        if (variants.length === 0) throw new Error('未生成可用题目');
        if (variants.length < Math.max(1, Math.ceil(amount * 0.6))) {
          throw new Error('题目质量不足，请重试');
        }
        return { variants };
      } catch (error: any) {
        lastError = error;
        if (attempt === 0) continue;
      }
    }
    throw new Error(lastError?.message || 'AI 生成题目解析失败，请重试');
  },
  generateVariantsProgressive: async (
    subject: Subject,
    nodes: string[],
    amount: number,
    strategy: '递进' | '随机' | '攻坚',
    onBatch: (batch: VariantQuestion[], generated: number, total: number) => void,
  ): Promise<{ variants: VariantQuestion[] }> => {
    return questionsApi.generateGovernedVariantsProgressive({
      proposalId: `legacy-${subject}-${strategy}-${amount}`,
      subject,
      nodes,
      amount,
      strategy,
      sourceSurface: 'manual',
      sourceReason: '兼容旧版专项练习出题请求',
      objectiveCode: 'custom_scope',
      explanationSummary: '兼容旧版专项练习出题请求',
      successCriteria: `完成 ${amount} 题专项训练`,
      generationPolicy: {
        allowAiGenerate: true,
        allowCache: true,
        allowRuleFallback: true,
      },
    }, onBatch).then((result) => ({ variants: result.variants }));
  },
  generateGovernedVariantsProgressive: async (
    input: GovernedGenerationRequest,
    onBatch: (batch: VariantQuestion[], generated: number, total: number) => void,
  ): Promise<GovernedGenerationResult> => {
    const total = Math.max(1, input.amount);
    const startedAt = Date.now();
    const normalizedInput = {
      ...input,
      amount: Math.max(1, input.amount),
      nodes: Array.from(new Set((input.nodes || []).map((item) => String(item || '').trim()).filter(Boolean))),
    };
    const cacheKey = getGenerationCacheKey(normalizedInput);
    const cached = generationCache.get(cacheKey);
    if (normalizedInput.generationPolicy.allowCache && cached && isCacheFresh(cached.timestamp, 30 * 60 * 1000)) {
      const sliced = cached.value.variants.slice(0, normalizedInput.amount).map((item) => ({
        ...item,
        source_kind: 'cache',
        source_label: '缓存复用',
      }));
      onBatch(sliced, sliced.length, normalizedInput.amount);
      void submitBestEffortInsert('question_generation_telemetry', {
        proposal_id: normalizedInput.proposalId,
        source_surface: normalizedInput.sourceSurface,
        source_reason: normalizedInput.sourceReason,
        source_kind: 'cache',
        quality: 'cache',
        requested_amount: normalizedInput.amount,
        accepted_amount: sliced.length,
        rejected_amount: 0,
        fallback_reason: null,
        latency_ms: Date.now() - startedAt,
      });
      return {
        variants: sliced,
        effectiveAmount: sliced.length,
        sourceKind: 'cache',
        quality: 'cache',
        validation: {
          requested: normalizedInput.amount,
          accepted: sliced.length,
          rejected: 0,
        },
      };
    }
    const all: VariantQuestion[] = [];
    const seen = new Set<string>();
    let failed = 0;
    const buildBatch = (remain: number) => {
      if (all.length === 0) return Math.min(3, remain);
      if (remain <= 4) return remain;
      return 3;
    };

    while (all.length < total) {
      const remain = total - all.length;
      const requestAmount = buildBatch(remain);
      try {
        const { variants } = await questionsApi.generateVariants(normalizedInput.subject, normalizedInput.nodes, requestAmount, normalizedInput.strategy);
        const accepted = variants
          .filter((item) => {
            const key = `${item.question_type}|${item.question_text.trim().toLowerCase()}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, requestAmount);
        if (accepted.length === 0) {
          failed += 1;
          if (all.length === 0 || failed >= 2) break;
          continue;
        }
        failed = 0;
        all.push(...accepted);
        onBatch(accepted, all.length, total);
      } catch (error) {
        failed += 1;
        if (all.length === 0 || failed >= 2) throw error;
        break;
      }
    }
    let sourceKind: GovernedGenerationResult['sourceKind'] = 'ai';
    let quality: GovernedGenerationResult['quality'] = all.length >= normalizedInput.amount ? 'full' : 'partial';
    let fallbackReason = '';
    if (all.length === 0 && normalizedInput.generationPolicy.allowRuleFallback) {
      const fallback = buildRuleFallbackVariants(normalizedInput, normalizedInput.amount);
      fallback.forEach((item, index) => {
        if (seen.has(`${item.question_type}|${item.question_text.trim().toLowerCase()}`)) return;
        seen.add(`${item.question_type}|${item.question_text.trim().toLowerCase()}`);
        all.push({ ...item, level: index + 1 });
      });
      if (all.length > 0) {
        onBatch(all.slice(0, normalizedInput.amount), Math.min(all.length, normalizedInput.amount), normalizedInput.amount);
        sourceKind = 'rule_fallback';
        quality = 'fallback';
        fallbackReason = 'ai_unavailable';
      }
    }
    if (all.length > 0 && all.length < normalizedInput.amount && normalizedInput.generationPolicy.allowRuleFallback) {
      const supplement = buildRuleFallbackVariants(normalizedInput, normalizedInput.amount - all.length);
      const extra = supplement.filter((item) => {
        const key = `${item.question_type}|${item.question_text.trim().toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, normalizedInput.amount - all.length);
      if (extra.length > 0) {
        all.push(...extra);
        onBatch(extra, Math.min(all.length, normalizedInput.amount), normalizedInput.amount);
        sourceKind = 'rule_fallback';
        quality = all.length >= normalizedInput.amount ? 'fallback' : 'partial';
        fallbackReason = fallbackReason || 'partial_ai_batch';
      }
    }
    if (all.length === 0) throw new Error('未生成可用题目，请稍后重试');
    const variants = all.slice(0, normalizedInput.amount);
    const result: GovernedGenerationResult = {
      variants,
      effectiveAmount: variants.length,
      sourceKind,
      quality,
      fallbackReason: fallbackReason || undefined,
      validation: {
        requested: normalizedInput.amount,
        accepted: variants.length,
        rejected: Math.max(0, normalizedInput.amount - variants.length),
      },
    };
    if (normalizedInput.generationPolicy.allowCache) {
      generationCache.set(cacheKey, {
        value: result,
        timestamp: Date.now(),
      });
    }
    void submitBestEffortInsert('question_generation_telemetry', {
      proposal_id: normalizedInput.proposalId,
      source_surface: normalizedInput.sourceSurface,
      source_reason: normalizedInput.sourceReason,
      source_kind: sourceKind,
      quality,
      requested_amount: normalizedInput.amount,
      accepted_amount: variants.length,
      rejected_amount: Math.max(0, normalizedInput.amount - variants.length),
      fallback_reason: fallbackReason || null,
      latency_ms: Date.now() - startedAt,
    });
    return result;
  },

  swipeReview: async (id: string, action: 'again' | 'hard' | 'easy'): Promise<Question> => {
    let currentRow: Question | null = null;
    if (isLocalDataApiMode()) {
      const all = await questionsApi.getAll();
      currentRow = all.find((item) => item.id === id) || null;
      if (!currentRow) throw new Error('题目不存在');
    } else {
      const current = await supabase
        .from('questions')
        .select('*')
        .eq('id', id)
        .single();
      if (current.error || !current.data) throw new Error(current.error?.message || '题目不存在');
      currentRow = normalizeQuestionRow(current.data);
    }
    const currentConfidence = currentRow.confidence || 0.5;
    let confidence = currentConfidence;
    let days = 1;
    if (action === 'again') {
      confidence = Math.max(0, currentConfidence - 0.15);
      days = 1;
    } else if (action === 'hard') {
      confidence = Math.min(1, currentConfidence + 0.03);
      days = 2;
    } else {
      confidence = Math.min(1, currentConfidence + 0.12);
      days = 4;
    }
    const mastery_level = Math.round(confidence * 100);
    const next_review_date = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    return questionsApi.update(id, {
      confidence,
      mastery_level,
      next_review_date,
      review_count: (currentRow.review_count || 0) + 1,
    });
  },

  submitReviewAttempt: async (input: SubmitReviewAttemptInput): Promise<SubmitReviewAttemptResult> => {
    const cached = readWritebackLedger<SubmitReviewAttemptResult>(input.writebackContext?.idempotencyKey);
    if (cached) return cached;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    const fallbackAction = input.rating === 'forgot' ? 'again' : input.rating === 'mastered' ? 'easy' : 'hard';
    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      try {
        const response = await localDataApiFetch<{ data: { attempt_id?: string; next_review_date?: string; question: Question } }>(
          token,
          '/review/attempt',
          {
            method: 'POST',
            body: JSON.stringify({
              questionId: input.questionId,
              userAnswer: input.userAnswer,
              isCorrect: input.isCorrect,
              rating: input.rating,
              correctAnswer: input.correctAnswer || null,
              selectedOptionText: input.selectedOptionText || null,
              diagnosis: input.diagnosis,
            }),
          },
        );
        invalidateQuestionsCache(user.id);
        statsApi.invalidateCache(user.id);
        invalidateAggregateQueries();
        void queryClient.setQueryData(queryKeys.recentAttempts(input.questionId, 6), (previous: ReviewAttemptRecord[] | undefined) => {
          if (!previous) return previous;
          return previous.slice(0, 5);
        });
        const result = {
          question: normalizeQuestionRow(response.data.question),
          attemptId: response.data.attempt_id,
          nextReviewDate: response.data.next_review_date || response.data.question?.next_review_date,
        };
        writeWritebackLedger(input.writebackContext?.idempotencyKey, result);
        void questionsApi.submitLearningTelemetry({
          eventType: 'review_writeback_committed',
          proposalId: input.writebackContext?.proposalId,
          sessionId: input.writebackContext?.sessionId,
          sessionKind: 'review',
          sourceSurface: input.writebackContext?.sourceSurface,
          sourceReason: input.writebackContext?.sourceReason,
          plannerSource: input.writebackContext?.plannerSource,
          judgeMode: input.writebackContext?.judgeMode || 'server',
          fallbackReason: input.writebackContext?.fallbackReason,
          completionOutcome: input.isCorrect ? 'correct' : 'wrong',
        });
        return result;
      } catch (error: any) {
        const question = await questionsApi.swipeReview(input.questionId, fallbackAction).catch(() => {
          throw error;
        });
        const result = {
          question,
          attemptId: undefined,
          nextReviewDate: question.next_review_date,
        };
        writeWritebackLedger(input.writebackContext?.idempotencyKey, result);
        void questionsApi.submitLearningTelemetry({
          eventType: 'review_writeback_fallback',
          proposalId: input.writebackContext?.proposalId,
          sessionId: input.writebackContext?.sessionId,
          sessionKind: 'review',
          sourceSurface: input.writebackContext?.sourceSurface,
          sourceReason: input.writebackContext?.sourceReason,
          plannerSource: input.writebackContext?.plannerSource,
          judgeMode: 'local',
          fallbackReason: 'local_api_review_attempt_failed',
          completionOutcome: input.isCorrect ? 'correct' : 'wrong',
        });
        return result;
      }
    }
    const rpc = await supabase.rpc('submit_review_attempt', {
      p_question_id: input.questionId,
      p_user_answer: input.userAnswer,
      p_is_correct: input.isCorrect,
      p_rating: input.rating,
      p_correct_answer: input.correctAnswer || null,
      p_selected_option_text: input.selectedOptionText || null,
      p_ai_diagnosis: input.diagnosis,
    });
    if (rpc.error) {
      if (isMissingFunctionError(rpc.error)) {
        const question = await questionsApi.swipeReview(input.questionId, fallbackAction);
        let attemptId: string | undefined;
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const attemptInsert = await supabase
              .from('question_review_attempts')
              .insert({
                user_id: user.id,
                question_id: input.questionId,
                question_type: question.question_type || null,
                user_answer: input.userAnswer || null,
                selected_option_text: input.selectedOptionText || null,
                correct_answer: input.correctAnswer || null,
                is_correct: input.isCorrect,
                rating: input.rating,
                error_type: question.error_type || question.knowledge_point || '未分类',
                ai_diagnosis: input.diagnosis || {},
                next_review_date: question.next_review_date || null,
              })
              .select('id')
              .single();
            if (!attemptInsert.error && attemptInsert.data?.id) {
              attemptId = attemptInsert.data.id;
            }
          }
        } catch {
        }
        const result = {
          question,
          attemptId,
          nextReviewDate: question.next_review_date,
        };
        writeWritebackLedger(input.writebackContext?.idempotencyKey, result);
        void questionsApi.submitLearningTelemetry({
          eventType: 'review_writeback_fallback',
          proposalId: input.writebackContext?.proposalId,
          sessionId: input.writebackContext?.sessionId,
          sessionKind: 'review',
          sourceSurface: input.writebackContext?.sourceSurface,
          sourceReason: input.writebackContext?.sourceReason,
          plannerSource: input.writebackContext?.plannerSource,
          judgeMode: 'local',
          fallbackReason: 'missing_submit_review_attempt_rpc',
          completionOutcome: input.isCorrect ? 'correct' : 'wrong',
        });
        return result;
      }
      throw new Error(rpc.error.message);
    }
    const rpcRow = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
    const refetch = await supabase
      .from('questions')
      .select('*')
      .eq('id', input.questionId)
      .single();
    if (refetch.error || !refetch.data) {
      throw new Error(refetch.error?.message || '复习提交成功，但读取题目快照失败');
    }
    invalidateQuestionsCache(user.id);
    statsApi.invalidateCache(user.id);
    invalidateAggregateQueries();
    void queryClient.setQueryData(queryKeys.recentAttempts(input.questionId, 6), (previous: ReviewAttemptRecord[] | undefined) => {
      if (!previous) return previous;
      return previous.slice(0, 5);
    });
    const result = {
      question: normalizeQuestionRow(refetch.data),
      attemptId: rpcRow?.attempt_id,
      nextReviewDate: rpcRow?.next_review_date || refetch.data.next_review_date,
    };
    writeWritebackLedger(input.writebackContext?.idempotencyKey, result);
    void questionsApi.submitLearningTelemetry({
      eventType: 'review_writeback_committed',
      proposalId: input.writebackContext?.proposalId,
      sessionId: input.writebackContext?.sessionId,
      sessionKind: 'review',
      sourceSurface: input.writebackContext?.sourceSurface,
      sourceReason: input.writebackContext?.sourceReason,
      plannerSource: input.writebackContext?.plannerSource,
      judgeMode: input.writebackContext?.judgeMode || 'server',
      fallbackReason: input.writebackContext?.fallbackReason,
      completionOutcome: input.isCorrect ? 'correct' : 'wrong',
    });
    return result;
  },

  triggerPlanCacheRebuild: async (days = 14) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      await localDataApiFetch<{ data: { ok: true } }>(token, '/review/plan-cache/rebuild', {
        method: 'POST',
        body: JSON.stringify({ days }),
      });
      return;
    }
    const result = await supabase.rpc('trigger_plan_cache_rebuild', { p_days: days });
    if (result.error) {
      if (isMissingFunctionError(result.error)) return;
      throw new Error(result.error.message);
    }
  },

  submitAiDiagnosisTelemetry: async (input: { questionId: string; status: 'success' | 'fallback' | 'error' | 'timeout'; latencyMs: number; errorMessage?: string; context?: LearningWritebackContext }) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    if (!isValidUuid(input.questionId)) return;
    if (isLocalDataApiMode()) return;
    const result = await supabase.from('ai_diagnosis_telemetry').insert({
      user_id: user.id,
      question_id: input.questionId,
      status: input.status,
      latency_ms: input.latencyMs,
      error_message: input.errorMessage,
    });
    if (result.error && !isMissingRelationError(result.error)) {
      return;
    }
    void questionsApi.submitLearningTelemetry({
      eventType: 'review_diagnosis',
      proposalId: input.context?.proposalId,
      sessionId: input.context?.sessionId,
      sessionKind: 'review',
      sourceSurface: input.context?.sourceSurface,
      sourceReason: input.context?.sourceReason,
      plannerSource: input.context?.plannerSource,
      judgeMode: input.context?.judgeMode,
      fallbackReason: input.status === 'fallback' || input.status === 'timeout' ? input.errorMessage || input.status : undefined,
      completionOutcome: input.status,
    });
  },

  submitLearningTelemetry: async (input: LearningTelemetryEventInput) => {
    await submitBestEffortInsert('learning_session_telemetry', {
      event_type: input.eventType,
      proposal_id: input.proposalId || null,
      session_id: input.sessionId || null,
      session_kind: input.sessionKind || null,
      source_surface: input.sourceSurface || null,
      source_reason: input.sourceReason || null,
      planner_source: input.plannerSource || null,
      judge_mode: input.judgeMode || null,
      generation_quality: input.generationQuality || null,
      fallback_reason: input.fallbackReason || null,
      completion_outcome: input.completionOutcome || null,
      metadata: input.metadata || {},
    });
  },

  submitPerfTelemetry: async (input: { eventType: string; latencyMs: number }) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    if (isLocalDataApiMode()) return;
    await supabase.from('perf_telemetry').insert({
      user_id: user.id,
      event_type: input.eventType,
      latency_ms: input.latencyMs,
    });
  },

  getKnowledgeNodeMastery: async (subject: string): Promise<Array<{ name: string; mastery: number }>> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      const response = await localDataApiFetch<{ data: Array<{ node_name: string; mastery: number }> }>(
        token,
        `/knowledge/node-mastery?subject=${encodeURIComponent(subject)}`,
      );
      return (response.data || []).map((row: any) => ({
        name: row.node_name,
        mastery: row.mastery,
      }));
    }
    const { data, error } = await supabase.rpc('get_knowledge_node_mastery', {
      p_user_id: user.id,
      p_subject: subject,
    });
    if (error) throw new Error(error.message);
    return (data || []).map((row: any) => ({
      name: row.node_name,
      mastery: row.mastery,
    }));
  },

  getGlobalErrorStats: async (days = 7): Promise<{ date_key: string; date_label: string; error_pattern: string; count: number }[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      const response = await localDataApiFetch<{ data: any[] }>(token, `/review/global-error-stats?days=${Math.max(1, days)}`);
      return (response.data || []).map((item: any) => ({
        date_key: String(item.date_key || ''),
        date_label: String(item.date_label || ''),
        error_pattern: String(item.error_pattern || 'unknown'),
        count: Number(item.count || 0),
      }));
    }
    const result = await supabase.rpc('get_global_error_stats', { p_days: days });
    if (result.error) {
      if (isMissingFunctionError(result.error)) return [];
      throw new Error(result.error.message);
    }
    return (result.data || []).map((item: any) => ({
      date_key: String(item.date_key || ''),
      date_label: String(item.date_label || ''),
      error_pattern: String(item.error_pattern || 'unknown'),
      count: Number(item.count || 0),
    }));
  },

  getRecentAttempts: async (questionId: string, limit = 6): Promise<ReviewAttemptRecord[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      const response = await localDataApiFetch<{ data: ReviewAttemptRecord[] }>(
        token,
        `/review/recent-attempts?questionId=${encodeURIComponent(questionId)}&limit=${Math.max(1, Math.min(20, limit))}`,
      );
      return response.data || [];
    }
    const requestLimit = Math.max(1, Math.min(20, limit));
    const result = await supabase
      .from('question_review_attempts')
      .select('id, question_id, user_answer, selected_option_text, correct_answer, is_correct, rating, ai_diagnosis, next_review_date, created_at')
      .eq('user_id', user.id)
      .eq('question_id', questionId)
      .order('created_at', { ascending: false })
      .limit(requestLimit);
    if (result.error) {
      if (isMissingRelationError(result.error)) return [];
      throw new Error(result.error.message);
    }
    return (result.data || []) as ReviewAttemptRecord[];
  },

  runPlannerShadow: async (input: { payload: PlannerInputPayload; ruleQueue: any[] }): Promise<PlanTelemetry | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    
    let lastError: any = null;
    const maxRetries = REVIEW_PLANNER_MAX_RETRIES;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REVIEW_PLANNER_TIMEOUT_MS);
      
      try {
        if (isLocalDataApiMode()) {
          const token = await getAccessToken();
          const response = await localDataApiFetch<{ data: PlanTelemetry | null }>(
            token,
            '/review/planner/shadow',
            {
              method: 'POST',
              body: JSON.stringify(input),
              signal: controller.signal,
            }
          );
          clearTimeout(timeoutId);
          return response.data || null;
        }
        // If not local api mode, we would call an edge function or RPC here.
        // For now we will assume the local-api handles it or fallback gracefully.
        clearTimeout(timeoutId);
        return null;
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastError = err;
        const isAbort = err.name === 'AbortError' || err.message?.includes('The user aborted a request');
        console.warn(`[runPlannerShadow] Attempt ${attempt + 1} failed: ${isAbort ? 'Timeout' : err.message}`);
        
        if (attempt < maxRetries) {
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    console.error(`[runPlannerShadow] All ${maxRetries + 1} attempts failed. Last error:`, lastError);
    return null;
  },
  runReviewPlanner: async (input: ReviewPlannerRunInput): Promise<ReviewPlannerRunResult> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');

    const trimmedRuleQueue = input.rule_queue.slice(0, Math.max(1, input.budget_count));
    const pageNumber = Math.max(1, Math.round(input.page_number || 1));
    const payload = buildPlannerInputPayload(user.id, {
      ...input,
      page_number: pageNumber,
      rule_queue: trimmedRuleQueue,
    });
    const strategyMeta = getReviewPlannerStrategyMeta(
      input.scope,
      trimmedRuleQueue,
      input.due_min_ratio,
    );
    const rolloutMetadata = resolveReviewPlannerRollout({
      plannerEnabled: reviewAiPlannerEnabled,
      grayPercent: reviewAiGrayPercent,
      seed: buildReviewPlannerGraySeed({
        subject: input.subject,
        scope: input.scope,
        pageNumber,
        questionIds: trimmedRuleQueue.map((item) => item.id),
      }),
      pageNumber,
    });
    let lastError: any = null;
    let lastLatencyMs = 0;

    const buildFallbackResult = (fallbackReason: string, reasons: string[]): ReviewPlannerRunResult => ({
      request_id: payload.request_id,
      plan_source: 'rule_fallback',
      plan_version: `${buildReviewPlannerPlanVersion(strategyMeta.strategy_template)}-fallback`,
      fallback_reason: fallbackReason,
      planning_latency_ms: lastLatencyMs,
      strategy_template: strategyMeta.strategy_template,
      strategy_label: strategyMeta.strategy_label,
      execution_queue: trimmedRuleQueue,
      rule_queue: trimmedRuleQueue,
      reasons,
      comparison_summary: summarizePlannerComparison(trimmedRuleQueue, undefined, trimmedRuleQueue, [`fallback:${fallbackReason}`]),
      risk_flags: {
        strategy_template: strategyMeta.strategy_template,
        strategy_label: strategyMeta.strategy_label,
      },
      rollout_metadata: rolloutMetadata,
    });

    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      const response = await localDataApiFetch<{ data: ReviewPlannerRunResult }>(
        token,
        '/review/planner/live',
        {
          method: 'POST',
          body: JSON.stringify({
            payload,
            ruleQueue: trimmedRuleQueue,
            strategyMeta: {
              ...strategyMeta,
              plan_version: buildReviewPlannerPlanVersion(strategyMeta.strategy_template),
            },
            rolloutMetadata,
          }),
        },
      );
      return {
        ...response.data,
        execution_queue: (response.data?.execution_queue || []).map(normalizeQuestionRow),
        rule_queue: (response.data?.rule_queue || []).map(normalizeQuestionRow),
      };
    }

    if (!rolloutMetadata.planner_enabled) {
      const fallbackResult = buildFallbackResult('planner_disabled', ['AI Planner 当前已关闭，已直接切回规则队列']);
      await persistPlannerTelemetry(user.id, payload, fallbackResult);
      return fallbackResult;
    }

    if (!rolloutMetadata.selected) {
      const fallbackResult = buildFallbackResult('gray_not_selected', ['当前会话未命中 AI 灰度，沿用规则队列']);
      await persistPlannerTelemetry(user.id, payload, fallbackResult);
      return fallbackResult;
    }

    for (let attempt = 0; attempt <= REVIEW_PLANNER_MAX_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REVIEW_PLANNER_TIMEOUT_MS);
      const startedAt = Date.now();
      try {
        const plannerOutput = await requestLivePlannerOutput({
          payload,
          strategyMeta,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        lastLatencyMs = Date.now() - startedAt;
        const result = applyPlannerGuardrails({
          payload,
          ruleQueue: trimmedRuleQueue,
          plannerOutput,
          strategyTemplate: strategyMeta.strategy_template,
          strategyLabel: strategyMeta.strategy_label,
          planningLatencyMs: lastLatencyMs,
          rolloutMetadata,
        });
        await persistPlannerTelemetry(user.id, payload, result);
        return result;
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastLatencyMs = Date.now() - startedAt;
        lastError = err;
        const isAbort = err?.name === 'AbortError' || err?.message?.includes('The user aborted a request');
        console.warn(`[runReviewPlanner] Attempt ${attempt + 1} failed: ${isAbort ? 'Timeout' : err?.message || err}`);
        if (attempt < REVIEW_PLANNER_MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    const fallbackReason = lastError?.name === 'AbortError' || lastError?.message?.includes('The user aborted a request')
      ? 'planner_timeout'
      : String(lastError?.message || '').includes('planner_json_missing') || String(lastError?.message || '').includes('planner_queue_empty')
        ? 'schema_invalid'
        : 'request_failed';
    const fallbackResult = buildFallbackResult(fallbackReason, ['AI 规划失败，已自动切回规则队列']);
    await persistPlannerTelemetry(user.id, payload, fallbackResult);
    return fallbackResult;
  },
};

export const practiceApi = {
  startSession: async (input: {
    subject: Subject;
    strategy: '递进' | '随机' | '攻坚';
    nodes: string[];
    planned_amount: number;
    generated_amount: number;
    writebackContext?: LearningWritebackContext;
  }) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      const response = await localDataApiFetch<{ data: { id: string | null } }>(token, '/practice/sessions', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return response.data?.id || null;
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
      .select('id')
      .single();
    if (result.error) {
      if (isMissingRelationError(result.error)) return null;
      throw new Error(result.error.message);
    }
    const sessionId = result.data?.id || null;
    void questionsApi.submitLearningTelemetry({
      eventType: 'practice_session_started',
      proposalId: input.writebackContext?.proposalId,
      sessionId: sessionId || undefined,
      sessionKind: 'practice',
      sourceSurface: input.writebackContext?.sourceSurface,
      sourceReason: input.writebackContext?.sourceReason,
      generationQuality: input.writebackContext?.generationQuality,
      completionOutcome: 'started',
    });
    return sessionId;
  },
  recordAttempt: async (input: {
    session_id: string;
    question_index: number;
    question_text: string;
    question_type: string;
    correct_answer: string;
    user_answer: string;
    is_correct: boolean;
    knowledge_point?: string;
    duration_seconds?: number;
    source_node?: string;
    ai_prompt_version?: string;
    writebackContext?: LearningWritebackContext;
  }) => {
    const cached = readWritebackLedger<{ ok: true }>(input.writebackContext?.idempotencyKey);
    if (cached) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      await localDataApiFetch<{ data: { ok: true } }>(token, '/practice/attempts/record', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      writeWritebackLedger(input.writebackContext?.idempotencyKey, { ok: true });
      return;
    }
    const result = await supabase
      .from('practice_attempts')
      .insert({
        user_id: user.id,
        ...input,
      });
    if (result.error) {
      if (isMissingRelationError(result.error)) return;
      throw new Error(result.error.message);
    }
    writeWritebackLedger(input.writebackContext?.idempotencyKey, { ok: true });
  },
  abandonSession: async (sessionId: string) => {
    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      await localDataApiFetch<{ data: { ok: true } }>(token, `/practice/sessions/${sessionId}/abandon`, {
        method: 'POST',
      });
      return;
    }
    const result = await supabase
      .from('practice_sessions')
      .update({
        status: 'abandoned',
        completed_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .eq('status', 'active');
    if (result.error) {
      if (isMissingRelationError(result.error)) return;
      throw new Error(result.error.message);
    }
  },
  submitAttempt: async (input: {
    session_id: string;
    question_index: number;
    question_text: string;
    question_type: string;
    correct_answer: string;
    user_answer: string;
    acceptable_answers: string[];
    subject: Subject;
    knowledge_point: string;
    ability: string;
    error_type: string;
    duration_seconds: number;
    source_node: string;
    ai_prompt_version: string;
    is_final: boolean;
    writebackContext?: LearningWritebackContext;
  }) => {
    const cached = readWritebackLedger<{ is_correct: boolean }>(input.writebackContext?.idempotencyKey);
    if (cached) return cached;
    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      const response = await localDataApiFetch<{ data: { is_correct: boolean } }>(token, '/practice/attempts/submit', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      writeWritebackLedger(input.writebackContext?.idempotencyKey, response.data);
      return response.data;
    }
    const rpc = await supabase.rpc('submit_practice_attempt', {
      p_session_id: input.session_id,
      p_question_index: input.question_index,
      p_question_text: input.question_text,
      p_question_type: input.question_type,
      p_correct_answer: input.correct_answer,
      p_user_answer: input.user_answer,
      p_acceptable_answers: input.acceptable_answers,
      p_subject: input.subject,
      p_knowledge_point: input.knowledge_point,
      p_ability: input.ability,
      p_error_type: input.error_type,
      p_duration_seconds: input.duration_seconds,
      p_source_node: input.source_node,
      p_ai_prompt_version: input.ai_prompt_version,
      p_is_final: input.is_final,
    });
    if (rpc.error) throw new Error(rpc.error.message);
    const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
    const result = {
      is_correct: Boolean(row?.is_correct),
    };
    writeWritebackLedger(input.writebackContext?.idempotencyKey, result);
    void questionsApi.submitLearningTelemetry({
      eventType: 'practice_writeback_committed',
      proposalId: input.writebackContext?.proposalId,
      sessionId: input.session_id,
      sessionKind: 'practice',
      sourceSurface: input.writebackContext?.sourceSurface,
      sourceReason: input.writebackContext?.sourceReason,
      judgeMode: input.writebackContext?.judgeMode || 'server',
      generationQuality: input.writebackContext?.generationQuality,
      fallbackReason: input.writebackContext?.fallbackReason,
      completionOutcome: result.is_correct ? 'correct' : 'wrong',
    });
    return result;
  },
};

function normalizeDashboardStatsFromRpc(raw: any): Stats | null {
  if (!raw || typeof raw !== 'object') return null;
  const subjectCounts = (raw.subject_counts || {}) as Record<string, number>;
  const weeklyActivity = Array.isArray(raw.weekly_activity) ? raw.weekly_activity.map((item: any) => Number(item || 0)) : [0, 0, 0, 0, 0, 0, 0];
  const errorTypes = Array.isArray(raw.error_types)
    ? raw.error_types.map((item: any) => ({
      name: String(item?.name || '未分类'),
      value: Number(item?.value || 0),
    }))
    : [];
  const subjectMastery = Array.isArray(raw.subject_mastery)
    ? raw.subject_mastery.map((item: any) => ({
      subject: String(item?.subject || '未知'),
      count: Number(item?.count || 0),
      score: Number(item?.score || 0),
    }))
    : [];
  const weaknessesList = Array.isArray(raw.weaknesses_list) ? raw.weaknesses_list as UserWeakness[] : [];
  const recent = Array.isArray(raw.recent) ? (raw.recent.map(normalizeQuestionRow) as Question[]) : [];
  return {
    total: Number(raw.total || 0),
    weaknessCount: Number(raw.weakness_count || 0),
    dueReviewCount: Number(raw.due_review_count || 0),
    topWeakness: raw.top_weakness || null,
    subjectCounts,
    newThisWeek: Number(raw.new_this_week || 0),
    recent,
    subjectMastery,
    weeklyActivity,
    errorTypes,
    weaknessesList,
  };
}

function normalizeDashboardStatsPayload(raw: any): Stats | null {
  if (!raw || typeof raw !== 'object') return null;
  if (
    typeof raw.dueReviewCount === 'number' ||
    typeof raw.total === 'number' ||
    Array.isArray(raw.subjectMastery)
  ) {
    return {
      total: Number(raw.total || 0),
      weaknessCount: Number(raw.weaknessCount || 0),
      dueReviewCount: Number(raw.dueReviewCount || 0),
      topWeakness: raw.topWeakness || null,
      subjectCounts: (raw.subjectCounts || {}) as Record<string, number>,
      newThisWeek: Number(raw.newThisWeek || 0),
      recent: Array.isArray(raw.recent) ? (raw.recent.map(normalizeQuestionRow) as Question[]) : [],
      subjectMastery: Array.isArray(raw.subjectMastery) ? raw.subjectMastery : [],
      weeklyActivity: Array.isArray(raw.weeklyActivity) ? raw.weeklyActivity.map((item: any) => Number(item || 0)) : [0, 0, 0, 0, 0, 0, 0],
      errorTypes: Array.isArray(raw.errorTypes) ? raw.errorTypes : [],
      weaknessesList: Array.isArray(raw.weaknessesList) ? raw.weaknessesList : [],
    };
  }
  return normalizeDashboardStatsFromRpc(raw);
}

async function buildLocalStats(): Promise<Stats> {
  const questions = await questionsApi.getAll();
  const weaknesses = await weaknessApi.getAll();
  const total = questions.length;
  const weaknessCount = weaknesses.length;
  const now = new Date();
  const dueReviewCount = questions.filter((q) => !q.next_review_date || new Date(q.next_review_date) <= now).length;
  const topWeakness = weaknesses.length > 0 ? weaknesses[0] : null;
  const weaknessesList = weaknesses.slice(0, 4);
  const subjectCounts: Record<string, number> = {};
  const subjectMasterySum: Record<string, number> = {};
  const errorTypeCounts: Record<string, number> = {};
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 6);
  weekAgo.setHours(0, 0, 0, 0);
  const newThisWeek = questions.filter((q) => new Date(q.created_at) > weekAgo).length;
  const weeklyActivity = [0, 0, 0, 0, 0, 0, 0];
  questions.forEach((q) => {
    const subj = q.subject || '未知';
    subjectCounts[subj] = (subjectCounts[subj] || 0) + 1;
    const mastery = q.mastery_level ?? Math.round((q.confidence ?? 0.5) * 100);
    subjectMasterySum[subj] = (subjectMasterySum[subj] || 0) + mastery;
    const errType = q.error_type || '未分类';
    errorTypeCounts[errType] = (errorTypeCounts[errType] || 0) + 1;
    const createdAt = new Date(q.created_at);
    if (createdAt >= weekAgo) {
      const diffTime = createdAt.getTime() - weekAgo.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays <= 6) {
        weeklyActivity[diffDays]++;
      }
    }
  });
  const subjectMastery = Object.keys(subjectCounts).map((subj) => ({
    subject: subj,
    count: subjectCounts[subj],
    score: Math.round(subjectMasterySum[subj] / subjectCounts[subj]),
  }));
  const totalErrors = Object.values(errorTypeCounts).reduce((a, b) => a + b, 0);
  const errorTypes = Object.entries(errorTypeCounts)
    .map(([name, count]) => ({
      name,
      value: totalErrors > 0 ? Math.round((count / totalErrors) * 100) : 0,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((item) => ({ name: item.name, value: item.value }));
  return {
    total,
    weaknessCount,
    dueReviewCount,
    topWeakness,
    subjectCounts,
    newThisWeek,
    recent: [...questions].slice(0, 5),
    subjectMastery,
    weeklyActivity,
    errorTypes,
    weaknessesList,
  };
}

// ---- Stats ----
export const statsApi = {
  get: async (): Promise<Stats> => {
    const authResult = await supabase.auth.getUser();
    const user = authResult?.data?.user;
    if (!user) throw new Error('未登录');
    const startedAt = Date.now();
    const localMode = isLocalDataApiMode();
    const storageKey = getStatsCacheKey(user.id);
    const inMemory = statsCache.get(user.id);
    const persisted = inMemory || await readPersistentCache<Stats>('stats', storageKey);
    if (persisted && !localMode) {
      const cachedNormalized = normalizeDashboardStatsPayload(persisted.value);
      if (cachedNormalized) {
        const normalizedEntry: CacheEntry<Stats> = {
          value: cachedNormalized,
          timestamp: persisted.timestamp,
        };
        statsCache.set(user.id, normalizedEntry);
      } else {
        statsCache.set(user.id, persisted);
      }
      if (isCacheFresh(persisted.timestamp, STATS_CACHE_TTL_MS) && cachedNormalized) {
        trackCacheEvent('cache_dashboard_hit', startedAt);
        return cachedNormalized;
      }
    }
    try {
      let normalized: Stats | null = null;
      if (localMode) {
        normalized = await buildLocalStats();
      } else {
        const rpcResult = await supabase.rpc('get_dashboard_stats', { p_user_id: user.id });
        if (!rpcResult.error) {
          const rpcRow = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data;
          normalized = normalizeDashboardStatsPayload(rpcRow);
        }
      }
      if (normalized) {
        const entry: CacheEntry<Stats> = {
          value: normalized,
          timestamp: Date.now(),
        };
        statsCache.set(user.id, entry);
        await writePersistentCache('stats', storageKey, entry);
        trackCacheEvent('cache_dashboard_rpc_miss', startedAt);
        return normalized;
      }
    } catch {
    }
    try {
      const localStats = await buildLocalStats();
      const entry: CacheEntry<Stats> = {
        value: localStats,
        timestamp: Date.now(),
      };
      statsCache.set(user.id, entry);
      await writePersistentCache('stats', storageKey, entry);
      trackCacheEvent('cache_dashboard_local_fallback', startedAt);
      return localStats;
    } catch (error) {
      if (persisted) return persisted.value;
      throw error;
    }
  },

  getCached: async (): Promise<Stats | null> => {
    const authResult = await supabase.auth.getUser();
    const user = authResult?.data?.user;
    if (!user) return null;
    const inMemory = statsCache.get(user.id);
    const persisted = inMemory || await readPersistentCache<Stats>('stats', getStatsCacheKey(user.id));
    if (!persisted) return null;
    if (!inMemory) {
      statsCache.set(user.id, persisted);
    }
    return persisted.value;
  },

  invalidateCache: (userId?: string) => {
    if (userId) {
      statsCache.delete(userId);
      void removePersistentCache('stats', getStatsCacheKey(userId));
      return;
    }
    statsCache.clear();
  },
};

type CopilotLearningProfileOptions = {
  maxSamples?: number;
};

function buildTopListText(counter: Record<string, number>, maxItems = 5) {
  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxItems)
    .map(([name, count]) => `${name}(${count})`)
    .join('、');
}

export async function buildCopilotLearningProfile(
  options: CopilotLearningProfileOptions = {},
): Promise<string> {
  const maxSamples = options.maxSamples && options.maxSamples > 0 ? options.maxSamples : 8;
  try {
    await hydrateTagDictionaryOnce();
    const [questions, weaknesses, userState] = await Promise.all([
      questionsApi.getAll({ sortBy: 'latestWrong' }, { forceRefresh: true }),
      weaknessApi.getAll({ forceRefresh: true }),
      userLearningStateApi.get().catch(() => null),
    ]);
    const total = questions.length;
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const dueCount = questions.filter((item) => !item.next_review_date || new Date(item.next_review_date).getTime() <= now).length;
    const lowMasteryCount = questions.filter((item) => (item.mastery_level ?? Math.round((item.confidence ?? 0.5) * 100)) < 80).length;
    const createdThisWeek = questions.filter((item) => now - new Date(item.created_at).getTime() <= weekMs).length;
    const subjectCounter: Record<string, number> = {};
    const pointCounter: Record<string, number> = {};
    questions.forEach((item) => {
      const subject = item.subject || '未知科目';
      const point = item.knowledge_point || '未标注知识点';
      subjectCounter[subject] = (subjectCounter[subject] || 0) + 1;
      pointCounter[point] = (pointCounter[point] || 0) + 1;
    });
    const weaknessText = weaknesses
      .slice(0, 5)
      .map((item) => `${item.knowledge_point}(${item.error_count})`)
      .join('、');
    const sampleText = questions
      .slice(0, maxSamples)
      .map((item, index) => {
        const stem = (item.question_text || '').replace(/\s+/g, ' ').slice(0, 36);
        const mastery = item.mastery_level ?? Math.round((item.confidence ?? 0.5) * 100);
        return `${index + 1}. [ID:${item.id}] [${item.subject}] ${item.knowledge_point} 掌握度${mastery} 题干:${stem}`;
      })
      .join('\n');
    const drawerByTag = userState?.learning_content?.drawerByTag || {};
    const resolveDrawerByKnowledgePoint = (knowledgePoint: string) => {
      const direct = (drawerByTag as any)?.[knowledgePoint];
      if (direct) return { key: knowledgePoint, drawer: direct as any };
      const normalizedPoint = normalizeScopeKey(knowledgePoint);
      for (const [key, value] of Object.entries(drawerByTag as any)) {
        const normalizedKey = normalizeScopeKey(key);
        const normalizedTitle = normalizeScopeKey((value as any)?.title);
        if (normalizedPoint && (normalizedPoint === normalizedKey || normalizedPoint === normalizedTitle)) {
          return { key, drawer: value as any };
        }
      }
      return null;
    };
    const pointSummaryText = Object.entries(pointCounter)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([point]) => {
        const resolved = resolveDrawerByKnowledgePoint(point);
        const drawer = resolved?.drawer || {};
        const summary = String(drawer?.summary || '').replace(/\s+/g, ' ').slice(0, 120);
        const markdown = String(drawer?.markdown || '').replace(/\s+/g, ' ').slice(0, 120);
        const tagId = String(drawer?.tag_id || '').trim() || '未记录';
        const nodeId = String(drawer?.node_id || '').trim() || '未记录';
        return `${point}（key=${resolved?.key || '未匹配'}，tag_id=${tagId}，node_id=${nodeId}）：总结=${summary || '暂无'}；补充=${markdown || '暂无'}`;
      })
      .join('\n');
      
    const customKp = userState?.tag_extensions?.knowledge_point || [];
    const allEnKp = [...getKnowledgePointsBySubject('英语'), ...customKp];
    const allCKp = [...getKnowledgePointsBySubject('C语言'), ...customKp];

    return `学习档案快照（系统提供，可信）：
- 错题总数：${total}
- 待复习题数：${dueCount}
- 低掌握度题数（<80）：${lowMasteryCount}
- 近7天新增：${createdThisWeek}
- 科目分布：${buildTopListText(subjectCounter, 6) || '暂无'}
- 高频知识点：${buildTopListText(pointCounter, 10) || '暂无'}
- 主知识点高频统计：${weaknessText || '暂无'}
- 最近错题样本：
${sampleText || '暂无'}
- 知识点总结快照（用于避免重复、做增量优化）：
${pointSummaryText || '暂无'}

（重要）当前系统完整标签库（必须从中选择，切勿自己生造，系统会自动做模糊匹配）：
- 科目：英语、C语言
- 英语知识点：${allEnKp.join('、')}
- C语言知识点：${allCKp.join('、')}

请严格基于这份学习档案回答用户“弱点/错题分布/复习优先级”等问题；如果总数为0，再明确说明暂无错题数据。`;
  } catch (error) {
    return `学习档案快照获取失败：${String(error)}。请先提示用户当前无法读取错题库，然后给出排查建议。`;
  }
}

// ---- AI System Prompt ----
function buildAiSystemPrompt() {
  return `你是一个学习分类系统，负责分析用户的错题。

用户会提供题目（可能附带文字）和错误描述（"我哪里错了"）。
请分析错题，并生成标准化错题卡片，格式如下（用<CARD>和</CARD>包裹，内容必须是合法JSON）：

<CARD>
{
  "subject": "英语 或 C语言",
  "question_text": "完整题目内容",
  "knowledge_point": "必须从对应的知识点列表中选择最合适的一个",
  "note": "非结构化补充说明，比如你的分析建议"
}
</CARD>

知识点列表：
- 英语: ${getKnowledgePointsBySubject('英语').join(", ")}
- C语言: ${getKnowledgePointsBySubject('C语言').join(", ")}

规则：
1. 不允许用户选分类，AI强制结构化
2. 只能从给定知识点列表中选择，不允许新增分类
3. 始终用中文回复，语气友好专业
4. JSON中不要有注释，确保是合法JSON格式
5. note 必须高效、直击痛点，拒绝任何废话和死板套路。不需要任何固定模板或固定小标题，直接根据题目给出清晰可编辑的自然语言解析即可，但要覆盖：本题考查点、为什么会错、以及基于题干证据的正确推导与结论。
6. 禁止空泛措辞，如“需要严格按照定义”“一步步推导即可”等未落到本题证据的话；禁止输出像“步骤二：规则匹配”这样机械化的废话标题。`;
}

const AI_COPILOT_BASE_RULES = `你是“全能AI学伴”，只能处理学习相关请求：错题解答、错题入库、复习建议、练习建议。
你会在用户消息中收到“对用户展示的能力”和“当前内部模式”，必须优先遵守前台能力边界：录入整理只处理错题草稿、知识点整理与结构修订；讲解追问只处理讲解、比较、错因分析与追问；计划推荐只提供学习建议、范围判断与下一步安排；跳转启动只负责生成 handoff card 并跳转到正式页面。
默认模式是“讲解”，系统不会再自动识别模式。你必须严格按当前模式执行：在讲解/推荐模式下只能讲解与建议，不能输出任何写动作。
当你判断用户可能需要“错题入库/知识点更新/错题修改”时：若当前能力是讲解/计划推荐，先给一句简短建议并提示切换到录入整理；若当前能力已是录入整理，直接输出可执行卡片，不要再追问“是否入库”。
如果用户只是简单的打招呼（如“你好”、“在吗”等）或日常闲聊，请简短友好地回复，**不需要**进行深度思考，也**不需要**背诵规则或提及你的能力清单。`;

const AI_COPILOT_INGEST_RULES = `输出规则：
1. 先输出给用户看的中文讲解。
2. 如果需要执行动作，必须在最末尾直接输出 <ACTION>...</ACTION>。注意：
  - \`<ACTION>\` 标签必须在最外层，绝不能被 \` \`\`\`json \` 等 Markdown 代码块包裹！
  - \`<ACTION>\` 内部必须是纯文本 JSON，绝不能带有 \` \\\`\\\`\\\`json \` 标记！
  - JSON 字符串内的换行必须使用转义字符 \\n，绝对不要输出真实的换行符！
  - 不要向用户展示任何执行动作的 JSON 代码。
  - 允许的 type 如下：
  - create_mistake: 生成待确认错题草稿，而不是直接执行入库。payload 可以是单题对象，也可以使用 questions 数组一次给出多题草稿。每道题都必须只给 1 个最终 knowledge_point，且 subject(如英语/C语言)、question_text(题干)、knowledge_point、note、correct_answer 必须完整。note 只要求“非空且可直接编辑”，禁止强制固定模板；summary 可为空，不要强行给每题预置总结。不再需要 mistake_point。如果是选择题，必须额外提供 options 数组（如 ["A. 选项1", "B. 选项2"]），并确保 question_text 纯净且不包含选项。若成功提取了文本和选项，你可以设置 "image_url": "" 来丢弃原始图片。
  - update_tags: 更新错题标签或内容。payload 必须包含 question_id，且 question_id 必须来自“最近错题样本”中的 ID。
   - start_review: 开始复习。payload必须包含: preset({ subject(必须单一学科，禁止混合英语与C语言), strategy(due_rescue/stubborn_focus/unmastered_boost/custom), scope(due/all/unmastered/stubborn), amount(建议10-20), sortBy(nearestDue/lowestMastery/latestWrong) })。优先输出“分包任务”语义，用小任务包描述本轮计划。
   - start_drill: 专项练习。payload必须包含: preset({ subject, nodes(知识点数组), amount, strategy(递进/随机/攻坚) })。
  - render_inline_quiz: 当用户要求出少量（小于等于 5 道）测试题、小测验时，使用 render_inline_quiz 动作返回结构化的题目数据，而不要使用 start_drill。题干、选项必须结构化，并提供正确答案和深入的解析。payload 必须包含: quiz_id(唯一标识), questions(数组，每题包含: id, subject, knowledge_point, question_text, options, correct_answer, explanation)。
  - delete_mistake: 删除特定错题。payload 必须包含 question_id，且 question_id 必须来自“最近错题样本”中的 ID。
  - update_learning_content: 智能更新知识点的 Markdown 总结内容。必须采用“知识浓缩”策略：将新规律归并为结构化的高质量 Markdown。允许自由结构，不要强制固定模板，不要自动补“考点/易错规律/常见知识点”等固定分区。输出的 markdown 必须包含“原有有效内容 + 本次新增规律”的融合结果，优先同类合并与去重，避免把旧内容整体删掉。当用户批量提供跨标签的知识点时，你可以返回一个 update_learning_content 动作，并在 payload.updates 中提供一个数组。如果是更新单个知识点，可以在 payload 中直接给出 node/tag 和 markdown。若能判断更新性质，额外提供 decision(skip/rewrite/create) 与 reason，帮助前端展示“无需更新 / 建议改写 / 建议新增”的说明。
3. 若当前能力是录入整理，默认策略是“直接产出可执行卡片（待前端确认执行）”；若当前能力不是录入整理，再采用“先建议再执行”。
4. 高风险动作 risk 必须为 "high"。
5. 仅学习域；若用户闲聊或越界，礼貌拒绝并引导到复习或练习动作。
6. 若当前能力不是跳转启动，禁止主动输出完整复习正文或完整专项练习正文；最多只保留轻量 CTA。若当前能力是计划推荐，也只给建议与理由，不直接创建正式会话。若当前能力是讲解，也禁止输出写动作。
7. 当用户要求改写“提分锦囊”或“知识点抽屉”内容时，或者用户主动提供知识点要求记录时，使用 update_learning_content，并在 payload 中给出 node/tag、markdown，或者使用 updates 数组批量更新多个知识点。默认采用“增量融合”策略：在保留已有有效信息的基础上合并新规律并去重，保持 Markdown 简洁结构化。
8. 你会收到“学习档案快照（系统提供，可信）”，必须优先依据该快照回答“我有哪些弱点/错题在哪些板块”。
9. 只有当快照里“错题总数=0”时，才能说“暂无错题”；否则必须给出分布、Top弱点、优先复习建议。
10. 若动作为 create_mistake 或 update_tags 且包含 note，note 必须采用高效简洁的结构，抛弃硬性的步骤1/2/3。每一点解析都必须引用本题证据词（如 by the time、starts、if 从句等）。
11. 禁止输出模板化废话，优先给出“题眼/关键信息 → 规则 → 结论”的高密度解析。若生成 start_review，说明文案要写成“专项任务包/分包任务”，避免“全量一次做完”的措辞。对于 render_inline_quiz 的 explanation，禁止使用“本题考查了…”、“建议复习…”等套话，必须直击用户的错因和正确答案依据。
12. 标签必须精确：knowledge_point、ability、error_type 必须从系统给定标签库中挑最贴近项；如果拿不准，也只能给出 1 个最接近的主知识点，不能同时输出多个最终知识点。
13. 在录入整理模式下，每次建议 create_mistake 或 update_tags 时，都要额外给出 update_learning_content 所需内容；但若本轮核心目标是入库错题，必须优先输出 create_mistake / update_tags，不要仅输出 update_learning_content。learning_updates 中若能判断更新性质，也额外补充 decision(skip/rewrite/create) 与 reason。
14. 当修改知识点内容（update_learning_content）或总结错题时，请基于题干证据、错因与解析进行归纳，不依赖 mistake_point 字段。
15. 若输出 update_learning_content，markdown 应面向“长期可维护的完整知识点结构”：同概念合并、跨题抽象、去重表达，避免“每题一段新增补充”。
16. update_learning_content 的 payload 必须包含 markdown（或者 updates 数组），直接给出完整的、结构化的高质量 Markdown 内容，作为“融合后版本”提交，确保包含历史有效要点与本次新增规律。
17. Markdown 可按内容自由组织，重点是结构清晰、信息可维护；不要强制统一骨架模板，也不要自动补固定栏目。
18. 不要机械地“每题单独一段”追加。收到新错题时，请把新规律融入对应的结构化模块中，同类合并，去重去冗，同时保留仍然有效的历史知识点。
19. 当用户对“待入库草稿”提出不满意/补充要求时（且当前是录入整理模式），优先重新输出 create_mistake 来覆盖草稿，不要只给解释性文字；并保证每题 note 补齐。 

ACTION JSON格式：
<ACTION>
{
  "type": "create_mistake",
  "risk": "low",
  "title": "错题与知识点入库",
  "description": "已生成待确认错题草稿，并提取了知识点总结",
  "payload": {
    "questions": [
      {
        "subject": "英语",
        "question_text": "He ____ (work) here since 2010.",
        "correct_answer": "has worked",
        "knowledge_point": "时态",
        "note": "题眼是 since + 过去时间点。错在把持续到现在的动作当成一般过去时。正确应使用 has/have done，因此答案是 has worked。"
      }
    ],
    "learning_updates": [
      {
        "tag": "时态",
        "decision": "rewrite",
        "reason": "本题补充了 since + 过去时间点 的稳定判定线索，需要重写到时态笔记中",
        "markdown": "### 现在完成时基本用法\n- 看到 since + 过去时间点，主句优先判断为 has/have done。"
      }
    ]
  }
}
</ACTION>`;

const AI_COPILOT_PROMPT = `${AI_COPILOT_BASE_RULES}\n\n${AI_COPILOT_INGEST_RULES}`;

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function stripImportedQuestion(raw: any) {
  if (!raw || typeof raw !== 'object') return {};
  const next = { ...raw };
  delete next.id;
  delete next.user_id;
  delete next.created_at;
  delete next.updated_at;
  return next;
}

function generateShareCode() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// ---- Sync API ----
export const syncApi = {
  export: async () => {
    const questions = await questionsApi.getAll();
    const exportData = {
      version: '1.0',
      appName: 'AI错题助手',
      exportedAt: new Date().toISOString(),
      count: questions.length,
      questions,
    };
    downloadJson(`wrong-questions-${new Date().toISOString().slice(0, 10)}.json`, exportData);
  },
  import: async (file: File, mode: 'merge' | 'replace') => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    const text = await file.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('文件不是合法 JSON');
    }
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.questions) ? parsed.questions : []);
    if (!Array.isArray(list)) throw new Error('导入格式不正确');

    if (mode === 'replace' && !isLocalDataApiMode()) {
      const { error } = await supabase.from('questions').delete().eq('user_id', user.id);
      if (error) throw new Error(error.message);
    }

    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      const payload = list.map((item) => stripImportedQuestion(item));
      const response = await localDataApiFetch<{ data: { imported: number } }>(token, '/sync/import', {
        method: 'POST',
        body: JSON.stringify({
          mode,
          questions: payload,
        }),
      });
      invalidateQuestionsCache(user.id);
      weaknessApi.invalidateCache(user.id);
      statsApi.invalidateCache(user.id);
      invalidateAggregateQueries();
      return { imported: Number(response.data?.imported || 0) };
    }

    let imported = 0;
    for (const item of list) {
      try {
        await questionsApi.create(stripImportedQuestion(item));
        imported++;
      } catch {
        // skip
      }
    }
    return { imported };
  },
  createShareCode: async () => {
    const all = await questionsApi.getAll();
    const payloadQuestions = all.map((q) => stripImportedQuestion(q));

    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      const response = await localDataApiFetch<{ data: { shareCode: string; count: number } }>(token, '/sync/share-code', {
        method: 'POST',
      });
      return response.data;
    }
    const rpc = await supabase.rpc('create_share_code', { p_question_ids: null });
    if (!rpc.error && rpc.data) {
      return { shareCode: String(rpc.data), count: payloadQuestions.length };
    }

    const code = generateShareCode();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    const insert = await supabase.from('shared_questions').insert({
      code,
      user_id: user.id,
      questions: payloadQuestions,
      expires_at: expiresAt,
    }).select('code').single();
    if (insert.error) throw new Error(insert.error.message);
    return { shareCode: insert.data.code, count: payloadQuestions.length };
  },
  importByCode: async (code: string) => {
    const normalizedCode = code.trim().toUpperCase();

    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      const response = await localDataApiFetch<{ data: { questions: any[] } }>(
        token,
        `/sync/import-by-code?code=${encodeURIComponent(normalizedCode)}`,
      );
      return { questions: Array.isArray(response.data?.questions) ? response.data.questions : [] };
    }

    const rpc = await supabase.rpc('get_shared_questions', { p_code: normalizedCode });
    if (!rpc.error && rpc.data) {
      return { questions: Array.isArray(rpc.data) ? rpc.data : [] };
    }
    if (rpc.error && !isMissingFunctionError(rpc.error)) {
      throw new Error(rpc.error.message || '获取分享内容失败');
    }

    const { data, error } = await supabase
      .from('shared_questions')
      .select('questions, expires_at')
      .eq('code', normalizedCode)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('分享码不存在或已过期');
    if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
      throw new Error('分享码已过期');
    }
    return { questions: Array.isArray(data.questions) ? data.questions : [] };
  }
};

// ---- Chat (streaming) ----
export const chatApi = {
  streamChat: async (
    messages: { role: string; content: any }[],
    onChunk: (chunk: string) => void,
    onComplete: (fullContent: string) => void,
    onError: (error: string) => void,
    options?: {
      enableThinking?: boolean;
      onReasoningChunk?: (chunk: string) => void;
      systemPrompt?: string;
      model?: string;
      signal?: AbortSignal;
    },
  ) => {
    await hydrateTagDictionaryOnce();
    const normalizeMessageContent = (rawContent: unknown): string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> => {
      if (Array.isArray(rawContent)) {
        const normalizedParts = rawContent.reduce<Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>>((parts, part) => {
          if (!part || typeof part !== 'object') return parts;
          const rawType = String((part as any).type || '').trim();
          if (rawType === 'text') {
            const text = String((part as any).text || '').trim();
            if (text) parts.push({ type: 'text', text });
            return parts;
          }
          if (rawType === 'image_url') {
            const imageUrl = String((part as any).image_url?.url || (part as any).url || '').trim();
            if (imageUrl) parts.push({ type: 'image_url', image_url: { url: imageUrl } });
            return parts;
          }
          return parts;
        }, []);
        return normalizedParts.length > 0 ? normalizedParts : '';
      }
      if (rawContent == null) return '';
      if (typeof rawContent === 'string') return rawContent;
      if (typeof rawContent === 'number' || typeof rawContent === 'boolean' || typeof rawContent === 'bigint') {
        return String(rawContent);
      }
      if (typeof rawContent === 'object') {
        const rawType = String((rawContent as any).type || '').trim();
        if (rawType === 'text') {
          const text = String((rawContent as any).text || '').trim();
          return text || '';
        }
        if (rawType === 'image_url') {
          const imageUrl = String((rawContent as any).image_url?.url || (rawContent as any).url || '').trim();
          return imageUrl ? [{ type: 'image_url', image_url: { url: imageUrl } }] : '';
        }
        return '';
      }
      return String(rawContent);
    };
    const normalizedMessages = (Array.isArray(messages) ? messages : []).map((item) => {
      const role = String(item?.role || '').trim();
      const normalizedRole = role === 'assistant' || role === 'system' || role === 'tool' ? role : 'user';
      return {
        role: normalizedRole,
        content: normalizeMessageContent(item?.content),
      };
    }).filter((item) => {
      if (Array.isArray(item.content)) return item.content.length > 0;
      return String(item.content || '').trim().length > 0;
    });
    let guard:
      | {
          release: (outcome: 'success' | 'failed') => void;
        }
      | null = null;
    try {
      guard = acquireAiRequestGuard({
        key: buildChatGuardKey({
          model: options?.model || (import.meta as any).env?.VITE_QWEN_MODEL || 'qwen3.5-plus',
          systemPrompt: options?.systemPrompt || buildAiSystemPrompt(),
          enableThinking: options?.enableThinking,
          messages: normalizedMessages,
        }),
        duplicateWindowMs: AI_CHAT_DUPLICATE_WINDOW_MS,
      });
    } catch (err) {
      onError(mapAiGuardErrorMessage(err));
      return;
    }
    const controller = new AbortController();
    let sourceAbortHandler: (() => void) | null = null;
    if (options?.signal) {
      sourceAbortHandler = () => controller.abort();
      options.signal.addEventListener('abort', sourceAbortHandler, { once: true });
    }
    const timeout = setTimeout(() => controller.abort(), AI_STREAM_TIMEOUT_MS);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        onError('登录状态已失效，请重新登录后再试');
        guard.release('failed');
        return;
      }

      const apiKey = (import.meta as any).env?.VITE_DASHSCOPE_API_KEY || '';
      
      const response = await fetch(getAiProxyUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: options?.model || (import.meta as any).env?.VITE_QWEN_MODEL || 'qwen3.5-plus',
          messages: [
            { role: 'system', content: options?.systemPrompt || buildAiSystemPrompt() },
            ...normalizedMessages
          ],
          stream: true,
          ...(options?.enableThinking ? { enable_thinking: true } : {})
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        onError(`AI代理请求失败: ${errText}`);
        guard.release('failed');
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let reasoningLength = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') {
              guard.release('success');
              onComplete(fullContent);
              return;
            }
            try {
              const parsed = JSON.parse(raw);
              const reasoningContent = parsed.choices?.[0]?.delta?.reasoning_content;
              if (reasoningContent && options?.onReasoningChunk) {
                reasoningLength += String(reasoningContent).length;
                if (reasoningLength > AI_STREAM_MAX_REASONING_CHARS) {
                  throw new Error('ai_guard_reasoning_too_long');
                }
                options.onReasoningChunk(reasoningContent);
              }
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullContent += content;
                if (fullContent.length > AI_STREAM_MAX_CONTENT_CHARS) {
                  throw new Error('ai_guard_content_too_long');
                }
                onChunk(content);
              }
            } catch (err: any) {
              if (String(err?.message || '').startsWith('ai_guard_')) {
                throw err;
              }
            }
          }
        }
      }
      guard.release('success');
      onComplete(fullContent);
    } catch (err) {
      guard.release('failed');
      const isAbortError = err instanceof Error && err.name === 'AbortError';
      const abortReason = isAbortError ? String((controller.signal as any)?.reason || '') : '';
      const errorText = isAbortError
        ? (abortReason === 'user_cancel' ? '已取消本次生成' : '网络请求超时，请重试')
        : mapAiGuardErrorMessage(err) || `网络请求失败: ${err}`;
      onError(errorText);
    } finally {
      clearTimeout(timeout);
      if (options?.signal && sourceAbortHandler) {
        options.signal.removeEventListener('abort', sourceAbortHandler);
      }
    }
  },
  streamCopilot: async (
    messages: { role: string; content: any }[],
    onChunk: (chunk: string, isReasoning?: boolean) => void,
    onComplete: (fullContent: string) => void,
    onError: (error: string) => void,
    options?: { injectLearningProfile?: boolean; enableThinking?: boolean; onReasoningChunk?: (chunk: string) => void; model?: string; signal?: AbortSignal }
  ) => {
    let finalSystemPrompt = AI_COPILOT_PROMPT;
    if (options?.injectLearningProfile !== false) {
      const profile = await buildCopilotLearningProfile();
      finalSystemPrompt = `${AI_COPILOT_PROMPT}\n\n${profile}`;
    }
    return chatApi.streamChat(
      messages,
      (chunk) => onChunk(chunk, false),
      onComplete,
      onError,
      {
        enableThinking: options?.enableThinking ?? false,
        onReasoningChunk: (chunk) => {
          if (options?.onReasoningChunk) options.onReasoningChunk(chunk);
          onChunk(chunk, true);
        },
        systemPrompt: finalSystemPrompt,
        model: options?.model,
        signal: options?.signal,
      }
    );
  },
};
