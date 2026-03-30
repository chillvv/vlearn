import { userLearningStateApi } from './api';
import { ABILITIES, ERROR_TYPES, getErrorTypesBySubject, getKnowledgePointsBySubject, type Question, type Subject, type TagExtensions } from './types';

export type CopilotRisk = 'low' | 'high';
export type CopilotActionType = 'create_mistake' | 'update_tags' | 'start_review' | 'start_drill' | 'delete_mistake' | 'update_learning_content';

export type CopilotActionProposal = {
  type: CopilotActionType;
  risk?: CopilotRisk;
  title?: string;
  description?: string;
  payload: Record<string, any>;
};

export function isOutOfScopeLearningRequest(input: string) {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return false;
  const denyKeywords = ['笑话', '天气', '电影', '八卦', '聊天', '闲聊', '段子'];
  return denyKeywords.some((keyword) => normalized.includes(keyword));
}

export function getCanonicalTagDictionary() {
  const extensions = getTagExtensions();
  return {
    subject: ['英语', 'C语言'],
    knowledge_point: Array.from(new Set([
      ...getKnowledgePointsBySubject('英语'),
      ...getKnowledgePointsBySubject('C语言'),
      ...(extensions.knowledge_point || []),
    ])),
    ability: Array.from(new Set([...ABILITIES, ...(extensions.ability || [])])),
    error_type: Array.from(new Set([...ERROR_TYPES, ...(extensions.error_type || [])])),
  };
}

export function normalizeMistakeDraft(
  draft: Partial<Question> & { subject?: Subject }
): Partial<Question> {
  const dictionary = getCanonicalTagDictionary();
  const fallbackSubject: Subject = draft.subject === 'C语言' ? 'C语言' : '英语';
  const subject = dictionary.subject.includes(String(draft.subject)) ? draft.subject : fallbackSubject;
  const subjectKnowledgePoints = getKnowledgePointsBySubject(subject);
  const subjectErrorTypes = getErrorTypesBySubject(subject);
  const defaultPoint = subjectKnowledgePoints[0] || (subject === 'C语言' ? '变量与数据类型' : '时态');
  const defaultAbility = ABILITIES[1] || '理解';
  const defaultErrorType = subjectErrorTypes[0] || ERROR_TYPES[0] || '时态';
  const knowledgePoint = dictionary.knowledge_point.includes(String(draft.knowledge_point))
    ? String(draft.knowledge_point)
    : defaultPoint;
  const ability = dictionary.ability.includes(String(draft.ability))
    ? String(draft.ability)
    : defaultAbility;
  const errorType = dictionary.error_type.includes(String(draft.error_type))
    ? String(draft.error_type)
    : defaultErrorType;
  return {
    ...draft,
    subject,
    knowledge_point: knowledgePoint,
    ability,
    error_type: errorType,
  };
}

export function collectMissingTagExtensions(
  input: Partial<Question> | undefined,
  dictionary: ReturnType<typeof getCanonicalTagDictionary>,
) {
  const additions: { knowledge_point: string[]; ability: string[]; error_type: string[] } = {
    knowledge_point: [],
    ability: [],
    error_type: [],
  };
  if (!input) return additions;
  if (input.knowledge_point && !dictionary.knowledge_point.includes(String(input.knowledge_point))) {
    additions.knowledge_point.push(String(input.knowledge_point));
  }
  if (input.ability && !dictionary.ability.includes(String(input.ability))) {
    additions.ability.push(String(input.ability));
  }
  if (input.error_type && !dictionary.error_type.includes(String(input.error_type))) {
    additions.error_type.push(String(input.error_type));
  }
  return additions;
}

export function approveNewTags(extensions: Partial<Record<'knowledge_point' | 'ability' | 'error_type', string[]>>) {
  if (typeof window === 'undefined') return;
  const current = getTagExtensions();
  const merged = {
    knowledge_point: Array.from(new Set([...(current.knowledge_point || []), ...(extensions.knowledge_point || [])])),
    ability: Array.from(new Set([...(current.ability || []), ...(extensions.ability || [])])),
    error_type: Array.from(new Set([...(current.error_type || []), ...(extensions.error_type || [])])),
  };

  // 如果是新增知识点，也把它加到 taxonomy 的 customMap 里
  // 我们通过 getKnowledgeNodeMeta 触发内部的兜底逻辑，或者显式维护一个 custom map
  // 因为现在 taxonomy 的 fallback 逻辑已经足够：如果是没见过的，会放到 "其他/其他/tag"

  window.localStorage.setItem('ai_copilot_tag_extensions_v2', JSON.stringify(merged));
  void persistTagExtensionsToCloud(merged);
}

export function getTagExtensionsSnapshot() {
  return getTagExtensions();
}

export function renameTagExtension(type: 'knowledge_point' | 'ability' | 'error_type', oldValue: string, newValue: string) {
  if (typeof window === 'undefined') return;
  const current = getTagExtensions();
  const list = [...(current[type] || [])];
  const mapped = list.map((item) => (item === oldValue ? newValue : item));
  current[type] = Array.from(new Set(mapped.filter(Boolean)));
  window.localStorage.setItem('ai_copilot_tag_extensions_v2', JSON.stringify(current));
  void persistTagExtensionsToCloud(current);
}

export function removeTagExtension(type: 'knowledge_point' | 'ability' | 'error_type', value: string) {
  if (typeof window === 'undefined') return;
  const current = getTagExtensions();
  current[type] = (current[type] || []).filter((item) => item !== value);
  window.localStorage.setItem('ai_copilot_tag_extensions_v2', JSON.stringify(current));
  void persistTagExtensionsToCloud(current);
}

export function parseCopilotAction(raw: string): CopilotActionProposal | null {
  const match = raw.match(/<ACTION>([\s\S]*?)<\/ACTION>/i);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim()) as CopilotActionProposal;
    if (!parsed || typeof parsed !== 'object' || !parsed.type || !parsed.payload) return null;
    const risk: CopilotRisk = parsed.risk === 'high' || parsed.type === 'delete_mistake' ? 'high' : 'low';
    return { ...parsed, risk };
  } catch {
    return null;
  }
}

export function stripActionBlock(raw: string) {
  return raw.replace(/<ACTION>[\s\S]*?<\/ACTION>/gi, '').trim();
}

function getTagExtensions(): Partial<Record<'knowledge_point' | 'ability' | 'error_type', string[]>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem('ai_copilot_tag_extensions_v2');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function hydrateTagExtensionsFromCloud() {
  if (typeof window === 'undefined') return;
  try {
    const local = getTagExtensions();
    const remote = await userLearningStateApi.get();
    const next = (remote.tag_extensions || {}) as TagExtensions;
    if (hasTagExtensions(next)) {
      window.localStorage.setItem('ai_copilot_tag_extensions_v2', JSON.stringify(next));
      return;
    }
    if (hasTagExtensions(local)) {
      await persistTagExtensionsToCloud(local);
    }
  } catch {
  }
}

export async function persistTagExtensionsToCloud(state?: TagExtensions) {
  if (typeof window === 'undefined') return;
  const payload = state || getTagExtensions();
  try {
    await userLearningStateApi.upsert({
      tag_extensions: payload,
    });
  } catch {
  }
}

function hasTagExtensions(state?: TagExtensions) {
  if (!state) return false;
  return ['knowledge_point', 'ability', 'error_type'].some((key) => (state[key as keyof TagExtensions] || []).length > 0);
}
