import { userLearningStateApi } from './api';
import {
  getKnowledgePointsBySubject,
  type CopilotActionRequest,
  type CopilotActionScope,
  type CopilotActionStage,
  type CopilotActionType,
  type CopilotActionValidationResult,
  type CopilotExecutionPreview,
  type CopilotExecutionReceipt,
  type CopilotInterpretActionType,
  type CopilotReadActionType,
  type CopilotRiskLevel,
  type CopilotWriteActionType,
  type MiniCopilotWorkMode,
  type Question,
  type Subject,
  type TagExtensions,
} from './types';
import { getKnowledgePointsBySubjectFromTaxonomy, isKnowledgePointInSubjectTaxonomy } from './knowledgeTaxonomy';

export type CopilotRisk = CopilotRiskLevel;

export type CopilotActionProposal = {
  type: CopilotActionType;
  risk?: CopilotRisk;
  title?: string;
  description?: string;
  payload: Record<string, any>;
};

export type KnowledgeUpdateDraft = {
  tag: string;
  markdown: string;
  note?: string;
  title?: string;
  reason?: string;
  decision?: 'skip' | 'rewrite' | 'create';
};

export const READ_COPILOT_ACTIONS: CopilotReadActionType[] = [
  'get_node_dossier',
  'list_node_mistakes',
  'rank_node_mistakes',
  'compare_mistakes',
];

export const INTERPRET_COPILOT_ACTIONS: CopilotInterpretActionType[] = [
  'explain_mistake',
];

export const WRITE_COPILOT_ACTIONS: CopilotWriteActionType[] = [
  'create_mistake',
  'update_mistake',
  'move_mistake_to_node',
  'delete_mistake',
  'batch_update_mistakes',
  'create_node_note_section',
  'rewrite_node_notebook',
  'reorder_node_notebook',
  'update_tags',
  'update_learning_content',
];

const SUPPORTED_COPILOT_ACTIONS: CopilotActionType[] = [
  ...READ_COPILOT_ACTIONS,
  ...INTERPRET_COPILOT_ACTIONS,
  ...WRITE_COPILOT_ACTIONS,
  'start_review',
  'start_drill',
];

const HIGH_RISK_ACTIONS = new Set<CopilotActionType>([
  'delete_mistake',
  'move_mistake_to_node',
  'batch_update_mistakes',
  'rewrite_node_notebook',
  'reorder_node_notebook',
]);

const MEDIUM_RISK_ACTIONS = new Set<CopilotActionType>([
  'create_mistake',
  'update_mistake',
  'create_node_note_section',
  'update_tags',
  'update_learning_content',
]);

export function extractKnowledgeUpdatesFromAction(action: CopilotActionProposal | null): KnowledgeUpdateDraft[] | undefined {
  if (!action) return undefined;
  const payload = action.payload || {};
  const rawItems = action.type === 'update_learning_content'
    ? (Array.isArray(payload.updates) ? payload.updates : [payload])
    : (Array.isArray(payload.learning_updates)
      ? payload.learning_updates
      : (payload.learning_update 
        ? [payload.learning_update] 
        : (payload.markdown ? [payload] : [])));
  const results = rawItems
    .filter((item: unknown) => Boolean(item) && typeof item === 'object')
    .map((item: any) => ({
      tag: String(item.tag || item.node || item.knowledge_point || '').trim(),
      markdown: String(item.markdown || ''),
      note: item.note ? String(item.note) : undefined,
      title: item.title ? String(item.title) : undefined,
      reason: item.reason ? String(item.reason) : undefined,
      decision: item.decision === 'skip' || item.decision === 'rewrite' || item.decision === 'create'
        ? item.decision
        : undefined,
    }))
    .filter(item => item.tag && item.markdown);
  return results.length > 0 ? results : undefined;
}

export function isOutOfScopeLearningRequest(input: string) {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return false;
  const denyKeywords = ['笑话', '天气', '电影', '八卦', '聊天', '闲聊', '段子'];
  return denyKeywords.some((keyword) => normalized.includes(keyword));
}

export function getCanonicalTagDictionary() {
  const extensions = getTagExtensions();
  const englishKnowledge = getKnowledgePointsBySubjectFromTaxonomy('英语');
  const cKnowledge = getKnowledgePointsBySubjectFromTaxonomy('C语言');
  const extensionKnowledge = (extensions.knowledge_point || []).filter((item) => (
    isKnowledgePointInSubjectTaxonomy('英语', item) || isKnowledgePointInSubjectTaxonomy('C语言', item)
  ));
  return {
    subject: ['英语', 'C语言'],
    knowledge_point: Array.from(new Set([
      ...englishKnowledge,
      ...cKnowledge,
      ...extensionKnowledge,
    ])),
    ability: [],
    error_type: [],
  };
}

export function normalizeMistakeDraft(
  draft: Partial<Question> & { subject?: Subject }
): Partial<Question> {
  const dictionary = getCanonicalTagDictionary();
  const fallbackSubject: Subject = draft.subject === 'C语言' ? 'C语言' : '英语';
  const subject: Subject = draft.subject === '英语' || draft.subject === 'C语言' ? draft.subject : fallbackSubject;
  const knowledgePoint = String(draft.knowledge_point || '').trim();
  const resolvedKnowledgePoint = dictionary.knowledge_point.includes(knowledgePoint)
    ? knowledgePoint
    : knowledgePoint;
  return {
    ...draft,
    subject,
    knowledge_point: resolvedKnowledgePoint,
    ability: '',
    error_type: '',
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
  return additions;
}

export function approveNewTags(extensions: Partial<Record<'knowledge_point' | 'ability' | 'error_type', string[]>>) {
  if (typeof window === 'undefined') return;
  const current = getTagExtensions();
  const merged = {
    knowledge_point: Array.from(new Set([...(current.knowledge_point || []), ...(extensions.knowledge_point || [])])),
    ability: [],
    error_type: [],
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

export function repairJson(json: string): string {
  let inString = false;
  let isEscaped = false;
  let result = '';
  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    if (char === '\\' && !isEscaped) {
      isEscaped = true;
      result += char;
    } else if (char === '"' && !isEscaped) {
      inString = !inString;
      result += char;
      isEscaped = false;
    } else if ((char === '\n' || char === '\r' || char === '\t') && inString) {
      if (char === '\n') result += '\\n';
      else if (char === '\r') result += '\\r';
      else if (char === '\t') result += '\\t';
      isEscaped = false;
    } else {
      result += char;
      isEscaped = false;
    }
  }
  // remove trailing commas
  result = result.replace(/,\s*([}\]])/g, '$1');
  return result;
}

export function parseCopilotAction(raw: string): CopilotActionProposal | null {
  const match = raw.match(/<ACTION>([\s\S]*?)<\/ACTION>/i);
  let jsonString = '';
  const supportedPattern = SUPPORTED_COPILOT_ACTIONS.join('|');
  if (match) {
    jsonString = match[1].trim();
  } else {
    const fallbackMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*?(?:"type"|"payload")[\s\S]*?\})\s*```/i);
    if (fallbackMatch) {
      jsonString = fallbackMatch[1].trim();
    } else {
      const bareMatch = raw.match(/(\{[\s\S]*?"(?:type|payload)"\s*:[\s\S]*?\})/i);
      if (bareMatch && new RegExp(`"(?:${supportedPattern})"`).test(bareMatch[0])) {
        jsonString = bareMatch[1].trim();
      } else {
        return null;
      }
    }
  }

  try {
    jsonString = jsonString.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();
    jsonString = repairJson(jsonString);
    const parsed = JSON.parse(jsonString) as CopilotActionProposal;
    if (!parsed || typeof parsed !== 'object' || !parsed.type || !parsed.payload) return null;
    if (!SUPPORTED_COPILOT_ACTIONS.includes(parsed.type)) return null;
    const risk = inferCopilotRisk(parsed.type, parsed.risk);
    return { ...parsed, risk };
  } catch {
    return null;
  }
}

export function stripActionBlock(raw: string) {
  let cleaned = raw.replace(/<ACTION>[\s\S]*?<\/ACTION>/gi, '').trim();
  const jsonBlocks = cleaned.match(/```(?:json)?\s*\{[\s\S]*?(?:"type"|"payload")[\s\S]*?\}\s*```/gi);
  if (jsonBlocks) {
    jsonBlocks.forEach(block => {
      if (new RegExp(`"(?:${SUPPORTED_COPILOT_ACTIONS.join('|')})"`).test(block)) {
        cleaned = cleaned.replace(block, '').trim();
      }
    });
  }
  const bareMatch = cleaned.match(/\{[\s\S]*?"(?:type|payload)"\s*:[\s\S]*?\}/i);
  if (bareMatch && new RegExp(`"(?:${SUPPORTED_COPILOT_ACTIONS.join('|')})"`).test(bareMatch[0])) {
    cleaned = cleaned.replace(bareMatch[0], '').trim();
  }
  // Also strip any prefix texts like "ACTION JSON格式："
  cleaned = cleaned.replace(/ACTION\s*JSON格式[：:]?/gi, '').trim();
  return cleaned;
}

export function stripActionForStreaming(raw: string) {
  const actionStart = raw.search(/<ACTION>/i);
  if (actionStart >= 0) {
    return raw.slice(0, actionStart).trimEnd();
  }
  const fallbackMatch = raw.match(/```(?:json)?\s*\{[\s\S]*?(?:"type"|"payload")[\s\S]*$/i);
  if (fallbackMatch && fallbackMatch.index !== undefined) {
    let isCompleteAndForeign = false;
    if (raw.endsWith('```')) {
      try {
        const jsonStr = fallbackMatch[0].replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        JSON.parse(jsonStr);
        if (!new RegExp(`"(?:${SUPPORTED_COPILOT_ACTIONS.join('|')})"`).test(jsonStr)) {
          isCompleteAndForeign = true;
        }
      } catch {
        // ignore
      }
    }
    if (!isCompleteAndForeign) {
      return raw.slice(0, fallbackMatch.index).trimEnd().replace(/ACTION\s*JSON格式[：:]?$/gi, '').trimEnd();
    }
  }
  const bareMatch = raw.match(/\{[\s\S]*?"(?:type|payload)"\s*:[\s\S]*$/i);
  if (bareMatch && bareMatch.index !== undefined) {
    let isCompleteAndForeign = false;
    try {
      JSON.parse(bareMatch[0]);
      if (!new RegExp(`"(?:${SUPPORTED_COPILOT_ACTIONS.join('|')})"`).test(bareMatch[0])) {
        isCompleteAndForeign = true;
      }
    } catch {
    }
    if (!isCompleteAndForeign) {
      return raw.slice(0, bareMatch.index).trimEnd().replace(/ACTION\s*JSON格式[：:]?$/gi, '').trimEnd();
    }
  }
  let cleaned = raw.replace(/<ACTION>[\s\S]*?<\/ACTION>/gi, '').trimEnd();
  cleaned = cleaned.replace(/ACTION\s*JSON格式[：:]?$/gi, '').trimEnd();
  return cleaned;
}

export function inferCopilotRisk(actionType: CopilotActionType, explicitRisk?: CopilotRisk | null): CopilotRisk {
  if (explicitRisk === 'high' || explicitRisk === 'medium' || explicitRisk === 'low') {
    return explicitRisk;
  }
  if (HIGH_RISK_ACTIONS.has(actionType)) return 'high';
  if (MEDIUM_RISK_ACTIONS.has(actionType)) return 'medium';
  return 'low';
}

function ensureStringList(input: unknown, limit = 20) {
  return Array.from(new Set((Array.isArray(input) ? input : [input]).map((item) => String(item || '').trim()).filter(Boolean))).slice(0, limit);
}

export function isCopilotWriteAction(actionType: CopilotActionType): actionType is CopilotWriteActionType {
  return WRITE_COPILOT_ACTIONS.includes(actionType as CopilotWriteActionType);
}

export function requiresCopilotPreview(actionType: CopilotActionType) {
  return HIGH_RISK_ACTIONS.has(actionType);
}

export function getCopilotRefreshHints(actionType: CopilotActionType) {
  if (actionType === 'move_mistake_to_node') {
    return ['原节点与目标节点统计、排序结果、笔记状态与 dossier 已进入同步刷新链路'];
  }
  if (actionType === 'delete_mistake' || actionType === 'batch_update_mistakes') {
    return ['当前节点统计、排序结果、笔记状态与 dossier 已进入同步刷新链路'];
  }
  if (actionType === 'rewrite_node_notebook' || actionType === 'reorder_node_notebook' || actionType === 'create_node_note_section') {
    return ['节点笔记结构与 dossier 已进入同步刷新链路'];
  }
  if (actionType === 'create_mistake' || actionType === 'update_mistake' || actionType === 'update_tags' || actionType === 'update_learning_content') {
    return ['当前对象详情与节点 dossier 已进入同步刷新链路'];
  }
  return [];
}

export function validateCopilotActionRequest(
  request: CopilotActionRequest,
  context: {
    currentTagId?: string;
    currentNodeId?: string;
    availableMistakeIds?: string[];
    allowCrossNodeTarget?: boolean;
  } = {},
): CopilotActionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const availableMistakeIds = new Set(ensureStringList(context.availableMistakeIds || [], 200));
  const allMistakeIds = ensureStringList([
    request.target_ids.mistake_id,
    request.target_ids.mistake_ids || [],
  ], 200);
  const refreshTargets = {
    tag_ids: ensureStringList([request.target_ids.tag_id, request.scope?.tag_id, context.currentTagId], 20),
    node_ids: ensureStringList([request.target_ids.node_id, request.scope?.node_id, context.currentNodeId], 20),
    mistake_ids: allMistakeIds,
  };

  if (isCopilotWriteAction(request.action_type)) {
    if (!request.reason) {
      warnings.push('当前写动作缺少修改原因');
    }
    if (!request.impact_scope || request.impact_scope.length === 0) {
      warnings.push('当前写动作缺少影响范围说明');
    }
  }

  if (request.action_type === 'create_mistake') {
    const hasContainer = Boolean(request.target_ids.node_id || request.scope?.node_id || String(request.field_patch?.knowledge_point || '').trim());
    if (!hasContainer) {
      errors.push('新增错题必须绑定目标 node_id 或知识点容器');
    }
  }

  if (request.action_type === 'update_mistake' || request.action_type === 'delete_mistake' || request.action_type === 'move_mistake_to_node' || request.action_type === 'update_tags') {
    if (!request.target_ids.mistake_id) {
      errors.push(`${request.action_type} 缺少 mistake_id`);
    }
  }

  if (request.action_type === 'update_mistake' || request.action_type === 'batch_update_mistakes' || request.action_type === 'update_tags') {
    if (!request.field_patch || Object.keys(request.field_patch).length === 0) {
      errors.push(`${request.action_type} 缺少字段 patch`);
    }
  }

  if (request.action_type === 'batch_update_mistakes') {
    if (allMistakeIds.length === 0) {
      errors.push('批量修改至少需要一个 mistake_id');
    }
  }

  if (request.action_type === 'create_node_note_section' || request.action_type === 'rewrite_node_notebook' || request.action_type === 'reorder_node_notebook' || request.action_type === 'update_learning_content') {
    if (!request.target_ids.node_id && !request.scope?.node_id) {
      errors.push(`${request.action_type} 缺少 node_id`);
    }
  }

  if (availableMistakeIds.size > 0) {
    const outOfScopeMistakeIds = allMistakeIds.filter((mistakeId) => !availableMistakeIds.has(mistakeId));
    if (outOfScopeMistakeIds.length > 0) {
      errors.push(`以下 mistake_id 不在当前节点范围内：${outOfScopeMistakeIds.join('、')}`);
    }
  }

  if (!context.allowCrossNodeTarget) {
    if (context.currentNodeId && request.target_ids.node_id && request.target_ids.node_id !== context.currentNodeId) {
      warnings.push('动作目标 node_id 与当前节点不同，将以当前节点作用域为准');
    }
    if (context.currentTagId && request.target_ids.tag_id && request.target_ids.tag_id !== context.currentTagId) {
      warnings.push('动作目标 tag_id 与当前标签不同，将以当前标签作用域为准');
    }
  }

  if (requiresCopilotPreview(request.action_type) && request.stage === 'execute') {
    warnings.push('高风险动作应先经过 preview / confirm / execute 三段式流程');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    refresh_targets: refreshTargets,
  };
}

const ACTION_FIELD_PATCH_KEYS = [
  'subject',
  'question_text',
  'category',
  'node',
  'image_url',
  'knowledge_point',
  'ability',
  'error_type',
  'question_type',
  'correct_answer',
  'note',
  'summary',
  'raw_ai_response',
  'normalized_payload',
  'payload_version',
  'validation_status',
  'render_mode',
  'mastery_level',
  'confidence',
  'next_review_date',
  'stability',
  'difficulty',
  'last_interval_days',
  'lapse_count',
  'predicted_recall',
  'priority_score',
  'plan_source',
  'stubborn_flag',
  'mastery_state',
  'mastered_at',
  'is_archived',
  'archived_at',
  'review_count',
] as const;

function extractActionFieldPatch(payload: Record<string, unknown>) {
  return ACTION_FIELD_PATCH_KEYS.reduce<Record<string, unknown>>((result, key) => {
    if (payload[key] !== undefined) {
      result[key] = payload[key];
    }
    return result;
  }, {});
}

export function inferMiniCopilotMode(input: {
  ask: string;
  activeMistakeId?: string | null;
  activeMistakeIds?: string[];
  explicitActionType?: CopilotActionType | null;
}): MiniCopilotWorkMode {
  const normalized = String(input.ask || '').trim().toLowerCase();
  const activeMistakeIds = ensureStringList([input.activeMistakeId, input.activeMistakeIds || []], 20);
  if (input.explicitActionType === 'compare_mistakes' || activeMistakeIds.length > 1 || /比较|对比|差异|共性|重复|similar/i.test(normalized)) {
    return 'multi_compare';
  }
  if (input.explicitActionType && ['create_mistake', 'update_mistake', 'move_mistake_to_node', 'delete_mistake', 'batch_update_mistakes', 'create_node_note_section', 'rewrite_node_notebook', 'reorder_node_notebook', 'update_tags', 'update_learning_content'].includes(input.explicitActionType)) {
    return 'precise_edit';
  }
  if (input.explicitActionType === 'explain_mistake' || activeMistakeIds.length === 1 || /这题|单题|题目|答案|为什么|解析/.test(normalized)) {
    return 'single_question';
  }
  if (/整理|总结|归纳|压缩|梳理|知识点|节点/.test(normalized)) {
    return 'node_summary';
  }
  return 'node_summary';
}

export function buildCopilotActionRequest(input: {
  action: CopilotActionProposal;
  scope?: CopilotActionScope;
  snapshot_version?: string;
  draft?: Partial<Question>;
  stage?: CopilotActionStage;
  reason?: string;
}): CopilotActionRequest {
  const payload = input.action.payload || {};
  const mistakeIds = ensureStringList([
    payload.mistake_ids,
    payload.ids,
    input.scope?.mistake_ids,
  ], 50);
  const mistakeId = String(
    payload.mistake_id
    || payload.question_id
    || input.scope?.mistake_id
    || mistakeIds[0]
    || '',
  ).trim();
  const nodeId = String(payload.node_id || input.scope?.node_id || '').trim();
  const tagId = String(payload.tag_id || input.scope?.tag_id || '').trim();
  const fieldPatch = {
    ...extractActionFieldPatch(payload),
    ...(payload.patch && typeof payload.patch === 'object' ? payload.patch : {}),
    ...(input.draft || {}),
  };
  return {
    action_type: input.action.type,
    title: input.action.title,
    description: input.action.description,
    target_ids: {
      tag_id: tagId || undefined,
      node_id: nodeId || undefined,
      mistake_id: mistakeId || undefined,
      mistake_ids: mistakeIds.length > 0 ? mistakeIds : undefined,
    },
    field_patch: fieldPatch,
    reason: input.reason || String(payload.reason || '').trim() || undefined,
    risk_level: inferCopilotRisk(input.action.type, input.action.risk),
    impact_scope: ensureStringList([payload.impact_scope, payload.affected_fields, Object.keys(fieldPatch)], 50),
    snapshot_version: input.snapshot_version,
    stage: input.stage || (requiresCopilotPreview(input.action.type) ? 'preview' : 'execute'),
    scope: input.scope,
  };
}

export function createCopilotPreview(preview: CopilotExecutionPreview): CopilotExecutionReceipt {
  return {
    action_type: 'update_mistake',
    requested_stage: 'preview',
    executed_stage: 'preview',
    success: true,
    target_ids: {},
    applied_fields: [],
    skipped_fields: [],
    validation_warnings: [],
    affected_objects: {
      tag_ids: [],
      node_ids: [],
      mistake_ids: [],
    },
    follow_up_updates: [],
    preview,
  };
}

export function summarizeCopilotReceipt(receipt: CopilotExecutionReceipt) {
  if (receipt.executed_stage === 'preview' && receipt.preview) {
    return `${receipt.action_type} 预览已生成：${receipt.preview.summary}`;
  }
  if (!receipt.success) {
    return `执行失败：${receipt.failure_reason || '未知原因'}`;
  }
  const applied = receipt.applied_fields.length > 0 ? `已应用 ${receipt.applied_fields.join('、')}` : '本次无字段落库';
  const warnings = receipt.validation_warnings.length > 0 ? `；警告：${receipt.validation_warnings.join('；')}` : '';
  const snapshot = receipt.latest_snapshot_version ? `；快照 ${receipt.latest_snapshot_version}` : '';
  return `${receipt.action_type} 已完成，${applied}${warnings}${snapshot}`;
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
  return (state.knowledge_point || []).length > 0;
}
