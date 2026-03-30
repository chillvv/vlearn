import { createClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import type {
  LearningContentState,
  Question,
  QuestionQuery,
  ReviewAttemptRecord,
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
import { ABILITIES, getErrorTypesBySubject, getKnowledgePointsBySubject } from './types';
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
import { dataAccessMode } from './config';
import { localDataApiFetch } from './localDataApi';

function getSupabaseConfig() {
  const env = (import.meta as any).env || {};
  const envUrl = String(env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const envAnonKey = String(env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  if (envUrl && envAnonKey) {
    return {
      url: envUrl,
      anonKey: envAnonKey,
    };
  }
  return {
    url: `https://${projectId}.supabase.co`,
    anonKey: publicAnonKey,
  };
}

const createSupabaseClient = () => {
  const config = getSupabaseConfig();
  return createClient(config.url, config.anonKey);
};
type SupabaseClientType = ReturnType<typeof createSupabaseClient>;

const globalScope = globalThis as typeof globalThis & {
  __vlearnSupabaseClient__?: SupabaseClientType;
};

export const supabase: SupabaseClientType = globalScope.__vlearnSupabaseClient__ || createSupabaseClient();

if (!globalScope.__vlearnSupabaseClient__) {
  globalScope.__vlearnSupabaseClient__ = supabase;
}

if (isLocalDataApiMode()) {
  const rawGetSession = supabase.auth.getSession.bind(supabase.auth);
  const rawGetUser = supabase.auth.getUser.bind(supabase.auth);
  supabase.auth.getUser = (async (jwt?: string) => {
    if (jwt) {
      return rawGetUser(jwt);
    }
    const sessionResult = await rawGetSession();
    return {
      data: {
        user: sessionResult.data.session?.user || null,
      },
      error: null,
    } as Awaited<ReturnType<typeof rawGetUser>>;
  }) as typeof supabase.auth.getUser;
}

const DEFAULT_AI_PROXY_URL = `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`;

function getAiProxyUrl() {
  const env = (import.meta as any).env || {};
  return env.VITE_AI_PROXY_URL || env.NEXT_PUBLIC_AI_PROXY_URL || DEFAULT_AI_PROXY_URL;
}

function isLocalDataApiMode() {
  return dataAccessMode === 'local_api';
}

async function getAccessToken() {
  const sessionResult = await supabase.auth.getSession();
  const token = sessionResult.data.session?.access_token;
  if (!token) throw new Error('未登录');
  return token;
}

function normalizeQuestionRow(row: any): Question {
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
    subject: row?.subject,
    knowledgePoint: row?.knowledge_point,
    ability: row?.ability,
    errorType: row?.error_type,
  });
  const normalizedErrorType = canonicalTags.errorType;
  return {
    ...row,
    subject: canonicalTags.subject,
    question_text: questionText,
    knowledge_point: canonicalTags.knowledgePoint,
    ability: canonicalTags.ability,
    question_type: row?.question_type || normalizedPayload.questionType,
    normalized_payload: normalizedPayload,
    validation_status: validationStatus,
    render_mode: renderMode,
    error_type: normalizedErrorType,
    payload_version: row?.payload_version || normalizedPayload.version,
  } as Question;
}

function isQuestionArchived(item: Partial<Question> | null | undefined) {
  return Boolean(item?.is_archived || item?.mastery_state === 'archived');
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
    ability: payload.ability,
    errorType: payload.error_type,
  });
  const questionText = formatQuestionTextForStorage(
    stem,
    normalizedPayload.questionType === 'choice'
      ? normalizedPayload.options.map((item) => `${item.label}. ${item.text}`)
      : [],
  );
  const validationStatus = normalizeValidationStatus(validation.valid);
  const normalizedErrorType = canonicalTags.errorType;
  return {
    ...payload,
    subject: canonicalTags.subject,
    question_text: questionText,
    knowledge_point: canonicalTags.knowledgePoint,
    ability: canonicalTags.ability,
    question_type: normalizedPayload.questionType,
    raw_ai_response: payload.raw_ai_response || payload.question_text || questionText,
    normalized_payload: normalizedPayload,
    payload_version: normalizedPayload.version,
    validation_status: validationStatus,
    render_mode: deriveRenderMode(validationStatus),
    error_type: normalizedErrorType,
  };
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
  ability?: string;
  errorType?: string;
}) {
  const baseTags = normalizeQuestionTags(input);
  
  // Get custom tags from learning state
  let customKnowledgePoints: string[] = [];
  let customErrorTypes: string[] = [];
  try {
    const state = await userLearningStateApi.get();
    customKnowledgePoints = state.tag_extensions?.knowledge_point || [];
    customErrorTypes = state.tag_extensions?.error_type || [];
  } catch (err) {
    // Ignore error, fallback to base
  }

  const subject = baseTags.subject;
  const allKps = [...(subject === '英语' ? getKnowledgePointsBySubject('英语') : getKnowledgePointsBySubject('C语言')), ...customKnowledgePoints];
  const allErrors = [...getErrorTypesBySubject(subject), ...customErrorTypes];

  let finalKp = input.knowledgePoint ? input.knowledgePoint.trim() : baseTags.knowledgePoint;
  let finalError = input.errorType ? input.errorType.trim() : baseTags.errorType;

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
  // If still not in list, but we have a custom tag, we might want to just keep it or fallback
  // Actually, to avoid losing user's intended tag, we keep it. If it's totally new, it's treated as custom.
  // But wait, user said "不会乱搞...存入对应知识点", so we should strictly map it to an existing tag if possible, otherwise fallback to baseTags.knowledgePoint.
  if (!allKps.includes(finalKp)) {
    finalKp = baseTags.knowledgePoint;
  }

  // Fuzzy match error type
  if (finalError && !allErrors.includes(finalError)) {
    let bestMatch = finalError;
    let minDistance = Infinity;
    for (const et of allErrors) {
      if (et.includes(finalError) || finalError.includes(et)) {
        bestMatch = et;
        break;
      }
      const dist = getEditDistance(finalError, et);
      if (dist <= 2 && dist < minDistance) {
        minDistance = dist;
        bestMatch = et;
      }
    }
    finalError = bestMatch;
  }
  if (!allErrors.includes(finalError)) {
    finalError = baseTags.errorType;
  }

  // Bypass RPC to avoid it destroying custom tags
  return {
    subject,
    knowledgePoint: finalKp,
    ability: baseTags.ability,
    errorType: finalError,
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
    const { data: { user } } = await supabase.auth.getUser();
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
  
  incrementError: async (knowledgePoint: string, ability: string): Promise<void> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');

    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      await localDataApiFetch<{ data: { ok: true } }>(token, '/weakness/increment', {
        method: 'POST',
        body: JSON.stringify({
          knowledge_point: knowledgePoint,
          ability,
        }),
      });
      weaknessApi.invalidateCache(user.id);
      statsApi.invalidateCache(user.id);
      return;
    }
    const rpc = await supabase.rpc('increment_user_weakness', {
      p_knowledge_point: knowledgePoint,
      p_ability: ability,
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
      .eq('ability', ability)
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
          ability: ability,
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

export const userLearningStateApi = {
  get: async (): Promise<UserLearningStateRecord> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    const storageKey = getLearningStateCacheKey(user.id);
    const inMemory = learningStateCache.get(user.id);
    const persisted = inMemory || await readPersistentCache<UserLearningStateRecord>('learning-state', storageKey);
    if (persisted) {
      learningStateCache.set(user.id, persisted);
      if (isCacheFresh(persisted.timestamp, LEARNING_STATE_CACHE_TTL_MS)) {
        return persisted.value;
      }
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
        setLearningSyncSnapshot({ state: 'synced', message: '本地已保存' });
        const fallback = {
          user_id: user.id,
          ...EMPTY_USER_LEARNING_STATE,
        };
        const entry: CacheEntry<UserLearningStateRecord> = {
          value: fallback,
          timestamp: Date.now(),
        };
        learningStateCache.set(user.id, entry);
        await writePersistentCache('learning-state', storageKey, entry);
        return fallback;
      }
      if (error) {
        if (persisted) return persisted.value;
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
        await writePersistentCache('learning-state', storageKey, entry);
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
      await writePersistentCache('learning-state', storageKey, entry);
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
        pendingLearningStatePatch = null;
        clearRetryTimer();
        setLearningSyncSnapshot({ state: 'synced', message: '本地已保存' });
        const fallback = {
          user_id: user.id,
          tag_extensions: patch.tag_extensions ?? current.tag_extensions,
          taxonomy_overrides: patch.taxonomy_overrides ?? current.taxonomy_overrides,
          learning_content: patch.learning_content ?? current.learning_content,
        };
        const entry: CacheEntry<UserLearningStateRecord> = {
          value: fallback,
          timestamp: Date.now(),
        };
        learningStateCache.set(user.id, entry);
        await writePersistentCache('learning-state', getLearningStateCacheKey(user.id), entry);
        return fallback;
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
        await writePersistentCache('learning-state', getLearningStateCacheKey(user.id), entry);
        return result;
      }
      lastError = error;
    }
    setLearningSyncSnapshot({ state: 'error', message: '同步失败，自动重试中' });
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
  if (query.l2) result = result.filter(item => (item.ability || item.error_type || '核心考点') === query.l2);
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
      return left - right;
    });
  } else if (query.sortBy === 'nearestDue') {
    result = result.sort((a, b) => new Date(a.next_review_date || 0).getTime() - new Date(b.next_review_date || 0).getTime());
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
    query.l2 ||
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
    if (query.l2) params.set('l2', query.l2);
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
  if (query.l2) {
    request = request.eq('ability', query.l2);
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

// ---- Questions ----
export const questionsApi = {
  getAll: async (query: QuestionQuery = {}, options?: { forceRefresh?: boolean }): Promise<Question[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    const startedAt = Date.now();
    if (hasQueryCondition(query)) {
      try {
        const remote = await fetchQuestionsByQueryFromRemote(user.id, query);
        trackCacheEvent('cache_questions_query_remote', startedAt);
        return applyQuestionQuery(remote, query);
      } catch {
      }
    }
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
    const { data: { user } } = await supabase.auth.getUser();
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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    return probeQuestionsSignature(user.id);
  },

  count: async (query: QuestionQuery = {}): Promise<number> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    if (query.onlyUnmastered) {
      const remote = await fetchQuestionsByQueryFromRemote(user.id, {
        ...query,
        onlyUnmastered: false,
        limit: undefined,
        offset: undefined,
      });
      return applyQuestionQuery(remote, {
        ...query,
        limit: undefined,
        offset: undefined,
      }).length;
    }
    if (isLocalDataApiMode()) {
      const params = new URLSearchParams();
      if (query.subject) params.set('subject', query.subject);
      if (query.category) params.set('category', query.category);
      if (query.l2) params.set('l2', query.l2);
      if (query.nodes && query.nodes.length > 0) params.set('nodes', query.nodes.join(','));
      if (query.onlyDue) params.set('onlyDue', '1');
      if (query.onlyStubborn) params.set('onlyStubborn', '1');
      if (query.includeArchived) params.set('includeArchived', '1');
      if (query.onlyArchived) params.set('onlyArchived', '1');
      const token = await getAccessToken();
      const response = await localDataApiFetch<{ data: { count: number } }>(token, `/questions/count?${params.toString()}`);
      return Number(response.data?.count || 0);
    }
    let request = supabase
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if (query.subject) {
      request = request.eq('subject', query.subject);
    }
    if (query.category) {
      request = request.eq('category', query.category);
    }
    if (query.l2) {
      request = request.eq('ability', query.l2);
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
    const { count, error } = await request;
    if (error) throw new Error(error.message);
    return count || 0;
  },

  countDue: async (query: Pick<QuestionQuery, 'subject'> = {}): Promise<number> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    if (isLocalDataApiMode()) {
      const params = new URLSearchParams();
      params.set('onlyDue', '1');
      if (query.subject) params.set('subject', query.subject);
      const token = await getAccessToken();
      const response = await localDataApiFetch<{ data: { count: number } }>(token, `/questions/count?${params.toString()}`);
      return Number(response.data?.count || 0);
    }
    const nowIso = new Date().toISOString();
    let request = supabase
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_archived', false)
      .or(`next_review_date.is.null,next_review_date.lte.${nowIso}`);
    if (query.subject) {
      request = request.eq('subject', query.subject);
    }
    const { count, error } = await request;
    if (error) throw new Error(error.message);
    return count || 0;
  },

  create: async (q: Partial<Question>): Promise<Question> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    const canonicalTags = await normalizeQuestionTagsForWrite({
      subject: q.subject,
      knowledgePoint: q.knowledge_point,
      ability: q.ability,
      errorType: q.error_type,
    });
    const normalized = normalizeQuestionPayload({
      ...(q as Partial<Question> & { options?: string[] }),
      subject: canonicalTags.subject,
      knowledge_point: canonicalTags.knowledgePoint,
      ability: canonicalTags.ability,
      error_type: canonicalTags.errorType,
    });
    const fullInsertPayload = {
      p_subject: normalized.subject,
      p_question_text: normalized.question_text,
      p_category: normalized.category,
      p_node: normalized.node,
      p_image_url: normalized.image_url,
      p_knowledge_point: normalized.knowledge_point,
      p_ability: normalized.ability,
      p_error_type: normalized.error_type,
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
          ability: normalized.ability,
          error_type: normalized.error_type,
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
          mastery_state: normalized.mastery_state,
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
    
    const rpcResult = await supabase.rpc('create_question', fullInsertPayload).select().maybeSingle();
    let insertedData = rpcResult.data;
    
    if (rpcResult.error || !insertedData) {
      const directPayload = {
        user_id: user.id,
        subject: normalized.subject,
        question_text: normalized.question_text,
        category: normalized.category,
        node: normalized.node,
        image_url: normalized.image_url,
        knowledge_point: normalized.knowledge_point,
        ability: normalized.ability,
        error_type: normalized.error_type,
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
        mastery_state: normalized.mastery_state,
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
      if (insertResult.error) throw new Error(insertResult.error.message);
      insertedData = insertResult.data;
      
      if (normalized.knowledge_point && normalized.ability) {
        await weaknessApi.incrementError(normalized.knowledge_point, normalized.ability);
      }
    }
    
    invalidateQuestionsCache(user.id);
    statsApi.invalidateCache(user.id);
    invalidateAggregateQueries();
    return normalizeQuestionRow(insertedData);
  },

  update: async (id: string, updates: Partial<Question>): Promise<Question> => {
    const normalized = (updates.question_text !== undefined || updates.correct_answer !== undefined || updates.question_type !== undefined)
      ? normalizeQuestionPayload(updates as Partial<Question> & { options?: string[] })
      : updates;
    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      const response = await localDataApiFetch<{ data: Question }>(token, '/questions/update', {
        method: 'POST',
        body: JSON.stringify({
          id,
          updates: normalized,
        }),
      });
      invalidateQuestionsCache();
      statsApi.invalidateCache();
      invalidateAggregateQueries();
      return normalizeQuestionRow(response.data);
    }
    let effectiveUpdates = normalized;
    let updateResult = await supabase
      .from('questions')
      .update(effectiveUpdates)
      .eq('id', id)
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
        .eq('id', id)
        .select()
        .maybeSingle();
    }
    if (updateResult.error) throw new Error(updateResult.error.message);
    if (updateResult.data) {
      invalidateQuestionsCache();
      statsApi.invalidateCache();
      invalidateAggregateQueries();
      return normalizeQuestionRow(updateResult.data);
    }
    const refetch = await supabase
      .from('questions')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (refetch.error) throw new Error(refetch.error.message);
    if (refetch.data) {
      invalidateQuestionsCache();
      statsApi.invalidateCache();
      invalidateAggregateQueries();
      return normalizeQuestionRow(refetch.data);
    }
    invalidateQuestionsCache();
    statsApi.invalidateCache();
    invalidateAggregateQueries();
    return normalizeQuestionRow({
      id,
      ...effectiveUpdates,
    });
  },

  batchUpdate: async (ids: string[], updates: Partial<Question>): Promise<number> => {
    if (!ids || ids.length === 0) return 0;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    const normalized = (updates.question_text !== undefined || updates.correct_answer !== undefined || updates.question_type !== undefined)
      ? normalizeQuestionPayload(updates as Partial<Question> & { options?: string[] })
      : updates;
    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      const response = await localDataApiFetch<{ data: { updated: number } }>(token, '/questions/batch-update', {
        method: 'POST',
        body: JSON.stringify({
          ids,
          updates: normalized,
        }),
      });
      invalidateQuestionsCache(user.id);
      statsApi.invalidateCache(user.id);
      invalidateAggregateQueries();
      return Number(response.data?.updated || 0);
    }
    let effectiveUpdates = normalized;
    let updateResult = await supabase
      .from('questions')
      .update(effectiveUpdates)
      .eq('user_id', user.id)
      .in('id', ids)
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
        .in('id', ids)
        .select('id');
    }
    if (updateResult.error) throw new Error(updateResult.error.message);
    invalidateQuestionsCache(user.id);
    statsApi.invalidateCache(user.id);
    invalidateAggregateQueries();
    return updateResult.data?.length || 0;
  },

  delete: async (id: string): Promise<void> => {
    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      await localDataApiFetch<{ data: { ok: true } }>(token, '/questions/delete', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      invalidateQuestionsCache();
      statsApi.invalidateCache();
      invalidateAggregateQueries();
      return;
    }
    const { error } = await supabase
      .from('questions')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
    invalidateQuestionsCache();
    statsApi.invalidateCache();
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

  generateVariants: async (
    subject: Subject,
    nodes: string[],
    amount: number,
    strategy: '递进' | '随机' | '攻坚',
  ): Promise<{ variants: VariantQuestion[] }> => {
    const prompt = `请作为专业教师，针对${subject}学科生成 ${amount} 道变式训练题。
    ${nodes.length > 0 ? `考察的知识点为：${nodes.join('、')}。` : ''}
    出题策略要求为：【${strategy}】（如果为“递进”，题目难度从易到难；如果为“随机”，难度随机；如果为“攻坚”，均为高难度题）。
    
    要求：
    1. 题目必须完整，如果是阅读理解完形填空等，必须包含完整的文章或上下文。
    2. 题干必须自洽，不能出现“根据短文/根据文章/What is the main idea of the passage”但未提供完整短文的情况。
    3. 英语阅读类题目必须先给不少于 70 词的短文，再给题目与选项。
    2. 返回格式必须是纯 JSON 数组，不要有任何额外的 Markdown 标记（不要包含 \`\`\`json 等）。
    
    JSON 格式如下：
    [
      {
        "level": 1, // 难度层级 1-5
        "question_type": "choice", // 必须是 "choice" (选择题) 或 "fill" (填空/解答题)
        "question_text": "完整的题目内容（包含所需的文章、题干）",
        "options": ["A. 选项1", "B. 选项2", "C. 选项3", "D. 选项4"], // 仅选择题需要，必须带字母前缀
        "correct_answer": "A", // 单选填字母，填空解答填具体答案
        "explanation": "详细的解题步骤和解析"
      }
    ]
    `;

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
        const variants: VariantQuestion[] = parsed.map((entry: any, idx: number) => {
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
          return {
            level: Number(item.level) > 0 ? Number(item.level) : (idx + 1),
            question_type,
            question_text: String(item.question_text || item.question || '题目加载失败'),
            options: question_type === 'choice' ? options : [],
            correct_answer: String(item.correct_answer || item.correctAnswer || ''),
            acceptable_answers: [],
            explanation: String(item.explanation || item.analysis || '暂无解析')
          };
        }).filter((item) => item.question_text.trim().length > 0 && shouldKeepGeneratedQuestion(item, subject));
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
    const total = Math.max(1, amount);
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
        const { variants } = await questionsApi.generateVariants(subject, nodes, requestAmount, strategy);
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
    if (all.length === 0) throw new Error('未生成可用题目，请稍后重试');
    return { variants: all.slice(0, total) };
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
    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
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
      invalidateQuestionsCache();
      statsApi.invalidateCache();
      invalidateAggregateQueries();
      void queryClient.setQueryData(queryKeys.recentAttempts(input.questionId, 6), (previous: ReviewAttemptRecord[] | undefined) => {
        if (!previous) return previous;
        return previous.slice(0, 5);
      });
      return {
        question: normalizeQuestionRow(response.data.question),
        attemptId: response.data.attempt_id,
        nextReviewDate: response.data.next_review_date || response.data.question?.next_review_date,
      };
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
        const fallbackAction = input.rating === 'forgot' ? 'again' : input.rating === 'mastered' ? 'easy' : 'hard';
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
        return {
          question,
          attemptId,
          nextReviewDate: question.next_review_date,
        };
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
    invalidateQuestionsCache();
    statsApi.invalidateCache();
    invalidateAggregateQueries();
    void queryClient.setQueryData(queryKeys.recentAttempts(input.questionId, 6), (previous: ReviewAttemptRecord[] | undefined) => {
      if (!previous) return previous;
      return previous.slice(0, 5);
    });
    return {
      question: normalizeQuestionRow(refetch.data),
      attemptId: rpcRow?.attempt_id,
      nextReviewDate: rpcRow?.next_review_date || refetch.data.next_review_date,
    };
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

  submitAiDiagnosisTelemetry: async (input: { questionId: string; status: 'success' | 'fallback' | 'error' | 'timeout'; latencyMs: number; errorMessage?: string }) => {
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
};

export const practiceApi = {
  startSession: async (input: {
    subject: Subject;
    strategy: '递进' | '随机' | '攻坚';
    nodes: string[];
    planned_amount: number;
    generated_amount: number;
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
    return result.data?.id || null;
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
  }) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      await localDataApiFetch<{ data: { ok: true } }>(token, '/practice/attempts/record', {
        method: 'POST',
        body: JSON.stringify(input),
      });
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
  }) => {
    if (isLocalDataApiMode()) {
      const token = await getAccessToken();
      const response = await localDataApiFetch<{ data: { is_correct: boolean } }>(token, '/practice/attempts/submit', {
        method: 'POST',
        body: JSON.stringify(input),
      });
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
    return {
      is_correct: Boolean(row?.is_correct),
    };
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
    const { data: { user } } = await supabase.auth.getUser();
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
    const { data: { user } } = await supabase.auth.getUser();
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
    const errorCounter: Record<string, number> = {};
    questions.forEach((item) => {
      const subject = item.subject || '未知科目';
      const point = item.knowledge_point || '未标注知识点';
      const errorType = item.error_type || '未标注错因';
      subjectCounter[subject] = (subjectCounter[subject] || 0) + 1;
      pointCounter[point] = (pointCounter[point] || 0) + 1;
      errorCounter[errorType] = (errorCounter[errorType] || 0) + 1;
    });
    const weaknessText = weaknesses
      .slice(0, 5)
      .map((item) => `${item.knowledge_point}/${item.ability}(${item.error_count})`)
      .join('、');
    const sampleText = questions
      .slice(0, maxSamples)
      .map((item, index) => {
        const stem = (item.question_text || '').replace(/\s+/g, ' ').slice(0, 36);
        const mastery = item.mastery_level ?? Math.round((item.confidence ?? 0.5) * 100);
        return `${index + 1}. [${item.subject}] ${item.knowledge_point}/${item.error_type} 掌握度${mastery} 题干:${stem}`;
      })
      .join('\n');
      
    const customKp = userState?.tag_extensions?.knowledge_point || [];
    const customEt = userState?.tag_extensions?.error_type || [];
    const allEnKp = [...getKnowledgePointsBySubject('英语'), ...customKp];
    const allCKp = [...getKnowledgePointsBySubject('C语言'), ...customKp];
    const allEnEt = [...getErrorTypesBySubject('英语'), ...customEt];
    const allCEt = [...getErrorTypesBySubject('C语言'), ...customEt];

    return `学习档案快照（系统提供，可信）：
- 错题总数：${total}
- 待复习题数：${dueCount}
- 低掌握度题数（<80）：${lowMasteryCount}
- 近7天新增：${createdThisWeek}
- 科目分布：${buildTopListText(subjectCounter, 6) || '暂无'}
- 高频知识点：${buildTopListText(pointCounter, 10) || '暂无'}
- 高频错因：${buildTopListText(errorCounter, 10) || '暂无'}
- user_weakness高频：${weaknessText || '暂无'}
- 最近错题样本：
${sampleText || '暂无'}

（重要）当前系统完整标签库（必须从中选择，切勿自己生造，系统会自动做模糊匹配）：
- 科目：英语、C语言
- 英语知识点：${allEnKp.join('、')}
- C语言知识点：${allCKp.join('、')}
- 能力维度：${ABILITIES.join('、')}
- 英语错因：${allEnEt.join('、')}
- C语言错因：${allCEt.join('、')}

请严格基于这份学习档案回答用户“弱点/错题分布/复习优先级”等问题；如果总数为0，再明确说明暂无错题数据。`;
  } catch (error) {
    return `学习档案快照获取失败：${String(error)}。请先提示用户当前无法读取错题库，然后给出排查建议。`;
  }
}

// ---- AI System Prompt ----
const AI_SYSTEM_PROMPT = `你是一个学习分类系统，负责分析用户的错题。

用户会提供题目（可能附带文字）和错误描述（"我哪里错了"）。
请分析错题，并生成标准化错题卡片，格式如下（用<CARD>和</CARD>包裹，内容必须是合法JSON）：

<CARD>
{
  "subject": "英语 或 C语言",
  "question_text": "完整题目内容",
  "knowledge_point": "必须从对应的知识点列表中选择最合适的一个",
  "ability": "必须从能力维度列表中选择一个",
  "error_type": "必须从错误原因列表中选择一个",
  "note": "非结构化补充说明，比如你的分析建议"
}
</CARD>

知识点列表：
- 英语: ${getKnowledgePointsBySubject('英语').join(", ")}
- C语言: ${getKnowledgePointsBySubject('C语言').join(", ")}

能力维度：
${ABILITIES.join(", ")}

错误原因：
- 英语: ${getErrorTypesBySubject('英语').join(", ")}
- C语言: ${getErrorTypesBySubject('C语言').join(", ")}

规则：
1. 不允许用户选分类，AI强制结构化
2. 只能从给定列表中选择，不允许新增分类，不允许使用“粗心/审题不清/不熟练”等泛化标签
3. 始终用中文回复，语气友好专业
4. JSON中不要有注释，确保是合法JSON格式
5. note 必须写成“可解析的专业步骤”，严格按以下格式（每行一条）：
   核心错因：一句话指出规则冲突
   步骤1 题眼定位：必须引用题干中的具体词或结构
   步骤2 规则匹配：写出对应语法/解题规则，不讲空话
   步骤3 答案回扣：明确为什么该答案成立、其他类型为何不成立
6. 禁止空泛措辞，如“需要严格按照定义”“一步步推导即可”“结合语境判断”等未落到本题证据的话`;

const AI_COPILOT_PROMPT = `你是“全能AI学伴”，只能处理学习相关请求：错题解答、错题入库、复习建议、练习建议。

输出规则：
1. 先输出给用户看的中文讲解。
2. 如果需要执行动作，必须在末尾输出 <ACTION>...</ACTION>，其中是合法JSON，且只包含以下type：
   - create_mistake: 错题入库。payload必须包含: subject(如英语/C语言), question_text(题干), knowledge_point, ability, error_type, note, correct_answer(若有), explanation(若有)。如果是选择题，必须额外提供 options 数组（如 ["A. 选项1", "B. 选项2"]），并确保 question_text 纯净且不包含选项。若成功提取了文本和选项，你可以设置 "image_url": "" 来丢弃原始图片。
   - update_tags: 更新错题标签或内容。如果是更新特定错题，payload 必须包含 question_id。
   - start_review: 开始复习。payload必须包含: preset({ subject, scope(due/all), amount, sortBy(nearestDue/lowestMastery) })。
   - start_drill: 专项练习。payload必须包含: preset({ subject, nodes(知识点数组), amount, strategy(递进/随机/攻坚) })。
   - delete_mistake: 删除特定错题。payload 必须包含 question_id。
   - update_learning_content
3. 默认策略是“先建议再执行”，所以动作只产出建议，不表示已执行。
4. 高风险动作 risk 必须为 "high"。
5. 仅学习域；若用户闲聊或越界，礼貌拒绝并引导到复习或练习动作。
6. 当用户要求改写“提分锦囊”或“知识点抽屉”内容时，使用 update_learning_content，并在 payload 中给出 node/tag、tips、summary、tables。
7. 你会收到“学习档案快照（系统提供，可信）”，必须优先依据该快照回答“我有哪些弱点/错题在哪些板块”。
8. 只有当快照里“错题总数=0”时，才能说“暂无错题”；否则必须给出分布、Top弱点、优先复习建议。
9. 若动作为 create_mistake 或 update_tags 且包含 note，note 必须采用“核心错因 + 步骤1/2/3”的结构化格式，并且每一步都必须引用本题证据词（如 by the time、starts、if 从句等）。
10. 禁止输出模板化废话，优先给“题眼词 → 规则 → 答案”的高密度解析。
11. 标签必须精确：knowledge_point、ability、error_type 必须从系统给定标签库中挑最贴近项，禁止新造泛化标签。
12. 每次建议 create_mistake 或 update_tags 时，都要额外给出 update_learning_content 所需内容（node、summary、tips），用于沉淀该知识点方法论。

ACTION JSON格式：
<ACTION>
{
  "type": "create_mistake",
  "risk": "low",
  "title": "发现新错题📝",
  "description": "请确认后执行",
  "payload": {
    "subject": "英语",
    "question_text": "完整的题目...",
    "options": ["A. xxx", "B. yyy"],
    "image_url": "",
    "knowledge_point": "时态",
    "ability": "规则应用",
    "error_type": "概念混淆",
    "note": "核心错因：by the time + 一般现在时从句，主句需用将来完成时\n步骤1 题眼定位：题干出现 by the time，且从句是 starts（一般现在时）\n步骤2 规则匹配：表示“到将来某时之前已完成”，主句应用 will have done\n步骤3 答案回扣：应选 will have completed，其他时态不满足先完成关系"
  }
}
</ACTION>`;

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
    },
  ) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        onError('登录状态已失效，请重新登录后再试');
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
          model: options?.model || (import.meta as any).env?.VITE_QWEN_MODEL || 'qwen-max',
          messages: [
            { role: 'system', content: options?.systemPrompt || AI_SYSTEM_PROMPT },
            ...messages
          ],
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        onError(`AI代理请求失败: ${errText}`);
        return;
      }

      const reader = response.body!.getReader();
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
          if (line.startsWith('data: ')) {
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') {
              onComplete(fullContent);
              return;
            }
            try {
              const parsed = JSON.parse(raw);
              const reasoningContent = parsed.choices?.[0]?.delta?.reasoning_content;
              if (reasoningContent && options?.onReasoningChunk) {
                options.onReasoningChunk(reasoningContent);
              }
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullContent += content;
                onChunk(content);
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      }
      onComplete(fullContent);
    } catch (err) {
      const errorText = err instanceof Error && err.name === 'AbortError'
        ? '网络请求超时，请重试'
        : `网络请求失败: ${err}`;
      onError(errorText);
    } finally {
      clearTimeout(timeout);
    }
  },
  streamCopilot: async (
    messages: { role: string; content: any }[],
    onChunk: (chunk: string, isReasoning?: boolean) => void,
    onComplete: (fullContent: string) => void,
    onError: (error: string) => void,
    options?: { injectLearningProfile?: boolean; enableThinking?: boolean; onReasoningChunk?: (chunk: string) => void; model?: string }
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
      }
    );
  },
};
