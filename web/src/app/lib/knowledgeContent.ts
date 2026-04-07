import { knowledgeNodesApi, userLearningStateApi } from './api';
import type { LearningContentState, LearningDrawerContent, LearningKeywordCard } from './types';
export type { LearningContentState, LearningDrawerContent, LearningKeywordCard } from './types';

export const LEARNING_CONTENT_KEY = 'mistake_learning_content_v1';

export type LearningSyncDecision = 'skip' | 'rewrite' | 'create';

export type LearningSyncResult = {
  decision: LearningSyncDecision;
  reason: string;
  drawer: LearningDrawerContent;
};

let learningContentMemoryState: LearningContentState = { tipsByNode: {}, drawerByTag: {} };
let legacyLearningContentCleared = false;

function cloneLearningContentState(state: LearningContentState): LearningContentState {
  return {
    tipsByNode: Object.fromEntries(
      Object.entries(state.tipsByNode || {}).map(([key, value]) => [key, Array.isArray(value) ? [...value] : []]),
    ),
    drawerByTag: Object.fromEntries(
      Object.entries(state.drawerByTag || {}).map(([key, value]) => [key, {
        ...(value || {}),
        keyword_cards: Array.isArray(value?.keyword_cards)
          ? value.keyword_cards.map((item) => ({
            title: String(item?.title || ''),
            keywords: Array.isArray(item?.keywords) ? item.keywords.map((keyword) => String(keyword || '')) : [],
          }))
          : undefined,
      }]),
    ),
  };
}

function clearLegacyLearningContentCache() {
  if (typeof window === 'undefined' || legacyLearningContentCleared) return;
  legacyLearningContentCleared = true;
  try {
    window.localStorage.removeItem(LEARNING_CONTENT_KEY);
  } catch {
  }
}

function createDefinitionTable(title: string, data: Array<{ name: string; desc: string; header?: string }>) {
  return {
    title,
    type: 'definition',
    data,
  };
}

function createKnowledgeCard(
  title: string,
  mastery: number,
  summary: string,
  primaryTips: Array<{ name: string; desc: string; header?: string }>,
  extraTips: Array<{ name: string; desc: string; header?: string }> = [],
) {
  return {
    title,
    mastery,
    summary,
    tables: [
      createDefinitionTable('基础技巧', primaryTips),
      ...(extraTips.length > 0 ? [createDefinitionTable('常见失误提醒', extraTips)] : []),
    ],
  };
}

export const KNOWLEDGE_DB: Record<string, any> = {
  default: {
    title: '知识点卡片',
    mastery: 50,
    summary: '该知识点正在持续补充中，建议先看关联错题再做同类训练。',
    tables: [],
  },
};

export function readLearningContentState(): LearningContentState {
  clearLegacyLearningContentCache();
  return cloneLearningContentState(normalizeLearningContentStateInternal(learningContentMemoryState).state);
}

export function writeLearningContentState(next: LearningContentState) {
  clearLegacyLearningContentCache();
  const normalized = normalizeLearningContentStateInternal(next).state;
  learningContentMemoryState = cloneLearningContentState(normalized);
  void persistLearningContentState(normalized);
}

export async function hydrateLearningContentStateFromCloud() {
  if (typeof window === 'undefined') return cloneLearningContentState(learningContentMemoryState);
  clearLegacyLearningContentCache();
  try {
    const nodes = await knowledgeNodesApi.getAll().catch(() => []);
    nodes.forEach(node => {
      if (!KNOWLEDGE_DB[node.node]) {
        KNOWLEDGE_DB[node.node] = {
          title: `${node.subject}：${node.node}`,
          markdown: node.tips_and_tricks || '',
        };
      }
    });

    const remote = await userLearningStateApi.get();
    const normalizedResult = normalizeLearningContentStateInternal(remote.learning_content || { tipsByNode: {}, drawerByTag: {} });
    learningContentMemoryState = cloneLearningContentState(normalizedResult.state);
    if (normalizedResult.changed) {
      void persistLearningContentState(normalizedResult.state);
    }
    return cloneLearningContentState(learningContentMemoryState);
  } catch {
    learningContentMemoryState = { tipsByNode: {}, drawerByTag: {} };
    return cloneLearningContentState(learningContentMemoryState);
  }
}

export async function persistLearningContentState(state?: LearningContentState) {
  if (typeof window === 'undefined') return;
  clearLegacyLearningContentCache();
  const payload = cloneLearningContentState(normalizeLearningContentStateInternal(state || learningContentMemoryState).state);
  try {
    await userLearningStateApi.upsert({
      learning_content: payload,
    });
  } catch {
  }
}

export function normalizeKnowledgeMarkdown(input: string) {
  return String(input || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const KNOWLEDGE_SECTION_TITLE = '';
const DEFAULT_CONCEPT_TITLE = '核心技巧';

function cleanKnowledgeSentence(input: string) {
  return String(input || '')
    .replace(/^[-*•\d.\)\s]+/, '')
    .replace(/^【[^】]+】/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeConceptTitle(input: string, fallback: string) {
  const title = String(input || '').replace(/[：:。；;，,]+$/g, '').trim();
  return title || fallback;
}

function normalizeConceptLookupKey(input: string) {
  return String(input || '')
    .replace(/[【】（）()《》“”"'`]/g, '')
    .replace(/\s+/g, '')
    .replace(/核心|技巧|方法|规律|总结|知识点|概念|要点|提醒/g, '')
    .toLowerCase();
}

function resolveConceptTitle(candidate: string, fallback: string, existingConcepts: string[] = []) {
  const normalizedCandidate = normalizeConceptTitle(candidate, fallback);
  const normalizedKey = normalizeConceptLookupKey(normalizedCandidate);
  if (!normalizedKey || normalizedCandidate.length > 18) return fallback;
  const matchedExisting = existingConcepts.find((item) => {
    const existingKey = normalizeConceptLookupKey(item);
    return Boolean(existingKey) && (existingKey === normalizedKey || existingKey.includes(normalizedKey) || normalizedKey.includes(existingKey));
  });
  return matchedExisting || normalizedCandidate;
}

function isPlaceholderKnowledgeLine(input: string) {
  const value = String(input || '').trim();
  if (!value) return true;
  return /待补充|未补充|暂无|未记录|暂缺|todo/i.test(value);
}

function splitKnowledgeLines(input: string) {
  return String(input || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function inferConceptBucket(line: string) {
  const text = cleanKnowledgeSentence(line);
  if (!text) return DEFAULT_CONCEPT_TITLE;
  if (/误|混淆|忽略|漏|陷阱|易错|错因|干扰|误判|误选/.test(text)) return '易错规律';
  if (/题眼|标志词|关键词|信号词|先行词|时间状语|触发词/.test(text)) return '判断线索';
  if (/先|再|优先|遇到|判断|定位|排除|选择|代入|抓住|回扣|看/.test(text)) return '解题方法';
  return DEFAULT_CONCEPT_TITLE;
}

function parseConceptMapFromSummary(summary: unknown) {
  const map = new Map<string, string[]>();
  const text = normalizeKnowledgeMarkdown(String(summary || ''));
  if (!text) return map;
  let currentConcept = DEFAULT_CONCEPT_TITLE;
  const lines = splitKnowledgeLines(text);
  const addItem = (conceptRaw: string, tipRaw: string) => {
    const concept = normalizeConceptTitle(conceptRaw, DEFAULT_CONCEPT_TITLE);
    const tip = cleanKnowledgeSentence(tipRaw);
    if (!tip || isPlaceholderKnowledgeLine(tip)) return;
    const prev = map.get(concept) || [];
    if (!prev.includes(tip)) {
      map.set(concept, [...prev, tip].slice(0, 8));
    }
  };
  for (const line of lines) {
    if (/^###\s+/.test(line)) {
      currentConcept = normalizeConceptTitle(line.replace(/^###\s+/, ''), DEFAULT_CONCEPT_TITLE);
      if (!map.has(currentConcept)) map.set(currentConcept, []);
      continue;
    }
    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch?.[1]) {
      addItem(currentConcept, bulletMatch[1]);
      continue;
    }
    const headingTipMatch = line.match(/^([^：:]{2,24})[：:]\s*(.+)$/);
    if (headingTipMatch?.[1] && headingTipMatch?.[2]) {
      addItem(headingTipMatch[1], headingTipMatch[2]);
      continue;
    }
    addItem(currentConcept, line);
  }
  return map;
}

function parseConceptMapFromIncoming(input: {
  targetNode: string;
  summary?: unknown;
  note?: unknown;
  mistakePoint?: unknown;
  markdown?: unknown;
}, existingConcepts: string[] = []) {
  const map = new Map<string, string[]>();
  const summaryText = normalizeKnowledgeMarkdown(String(input.summary || ''));
  const noteText = normalizeKnowledgeMarkdown(String(input.note || ''));
  const markdownText = normalizeKnowledgeMarkdown(String(input.markdown || ''));
  const mistakePoint = cleanKnowledgeSentence(String(input.mistakePoint || ''));
  const fallbackConcept = resolveConceptTitle(input.targetNode || DEFAULT_CONCEPT_TITLE, DEFAULT_CONCEPT_TITLE, existingConcepts);
  const addItem = (conceptRaw: string, tipRaw: string) => {
    const inferredConcept = resolveConceptTitle(conceptRaw, fallbackConcept, existingConcepts);
    const concept = inferredConcept || fallbackConcept;
    const tip = cleanKnowledgeSentence(tipRaw);
    if (!tip || tip.length < 4 || isPlaceholderKnowledgeLine(tip)) return;
    const prev = map.get(concept) || [];
    if (!prev.includes(tip)) {
      map.set(concept, [...prev, tip].slice(0, 8));
    }
  };
  const absorbText = (text: string, conceptSeed: string) => {
    if (!text) return;
    const lines = splitKnowledgeLines(text);
    for (const line of lines) {
      if (/^#{1,6}\s+/.test(line) || /^[-*]\s*$/.test(line) || /^---+$/.test(line)) continue;
      const stripped = cleanKnowledgeSentence(line);
      if (!stripped) continue;
      const labeled = stripped.match(/^([^：:]{2,24})[：:]\s*(.+)$/);
      if (labeled?.[1] && labeled?.[2]) {
        addItem(labeled[1], labeled[2]);
      } else {
        addItem(resolveConceptTitle(inferConceptBucket(stripped), conceptSeed, existingConcepts), stripped);
      }
    }
  };
  const structured = parseConceptMapFromSummary(summaryText);
  if (structured.size > 0) {
    structured.forEach((tips, concept) => {
      tips.forEach((tip) => addItem(concept, tip));
    });
  } else {
    absorbText(summaryText, fallbackConcept);
  }
  const noteLines = splitKnowledgeLines(noteText);
  for (const line of noteLines) {
    const tagged = line.match(/^【([^】]+)】\s*(.+)$/);
    if (!tagged?.[1] || !tagged?.[2]) continue;
    const tag = tagged[1];
    const tip = tagged[2];
    if (/考查知识点/.test(tag)) {
      addItem(resolveConceptTitle('判断线索', fallbackConcept, existingConcepts), tip);
    } else if (/错因分析/.test(tag)) {
      addItem(resolveConceptTitle('易错规律', fallbackConcept, existingConcepts), tip);
    } else if (/核心解析/.test(tag)) {
      addItem(resolveConceptTitle('解题方法', fallbackConcept, existingConcepts), tip);
    } else {
      addItem(fallbackConcept, tip);
    }
  }
  if (mistakePoint) {
    addItem(resolveConceptTitle('易错规律', fallbackConcept, existingConcepts), mistakePoint);
  }
  absorbText(markdownText, fallbackConcept);
  return map;
}

function mergeConceptMaps(base: Map<string, string[]>, incoming: Map<string, string[]>) {
  const merged = new Map<string, string[]>();
  base.forEach((tips, concept) => {
    merged.set(concept, [...tips]);
  });
  incoming.forEach((tips, concept) => {
    const current = merged.get(concept) || [];
    const next = [...current];
    tips.forEach((tip) => {
      if (!next.includes(tip)) next.push(tip);
    });
    merged.set(concept, next.slice(0, 8));
  });
  return new Map(Array.from(merged.entries()).slice(0, 20));
}

const SUMMARY_CONCEPT_PRIORITY = ['解题方法', '判断线索', '易错规律', '核心技巧'];

function sortConceptEntriesForSummary(map: Map<string, string[]>) {
  return Array.from(map.entries()).sort((left, right) => {
    const leftIndex = SUMMARY_CONCEPT_PRIORITY.indexOf(left[0]);
    const rightIndex = SUMMARY_CONCEPT_PRIORITY.indexOf(right[0]);
    const normalizedLeftIndex = leftIndex >= 0 ? leftIndex : SUMMARY_CONCEPT_PRIORITY.length + 1;
    const normalizedRightIndex = rightIndex >= 0 ? rightIndex : SUMMARY_CONCEPT_PRIORITY.length + 1;
    if (normalizedLeftIndex !== normalizedRightIndex) return normalizedLeftIndex - normalizedRightIndex;
    return left[0].localeCompare(right[0], 'zh-CN');
  });
}

function renderSummaryFromConceptMap(map: Map<string, string[]>) {
  const lines: string[] = [];
  map.forEach((tips, concept) => {
    if (tips.length === 0) return;
    lines.push(`### ${concept}`);
    tips.forEach((tip) => lines.push(`- ${tip}`));
    lines.push('');
  });
  return normalizeKnowledgeMarkdown(lines.join('\n'));
}

function condenseKeywordLabel(input: string) {
  const value = cleanKnowledgeSentence(input)
    .replace(/^先|^再|^要|^把|^用|^看|^注意/g, '')
    .trim();
  const shortText = value.split(/[，。；;：:、]/)[0]?.trim() || value;
  return shortText.slice(0, 10).trim();
}

function normalizeKeywordCards(cards: unknown): LearningKeywordCard[] {
  if (!Array.isArray(cards)) return [];
  return cards
    .map((item): LearningKeywordCard => {
      const rawKeywords = Array.isArray((item as any)?.keywords) ? ((item as any).keywords as unknown[]) : [];
      const keywords = Array.from(new Set(rawKeywords
        .map((keyword) => condenseKeywordLabel(String(keyword || '')))
        .filter((keyword): keyword is string => Boolean(keyword)))).slice(0, 4);
      return {
        title: normalizeConceptTitle(String((item as any)?.title || ''), ''),
        keywords,
      };
    })
    .filter((item) => item.title && item.keywords.length > 0)
    .slice(0, 4);
}

function buildKeywordCardsFromConceptMap(map: Map<string, string[]>) {
  return sortConceptEntriesForSummary(map)
    .slice(0, 4)
    .map(([concept, tips]) => ({
      title: concept,
      keywords: Array.from(new Set(tips.map((tip) => condenseKeywordLabel(tip)).filter(Boolean))).slice(0, 4),
    }))
    .filter((item) => item.keywords.length > 0);
}

function renderCompactSummaryFromKeywordCards(cards: LearningKeywordCard[]) {
  return normalizeKnowledgeMarkdown(
    cards
      .slice(0, 3)
      .map((card) => `- ${card.title}：${card.keywords.join(' / ')}`)
      .join('\n'),
  );
}

function parseConceptMapFromKeywordCards(cards: LearningKeywordCard[]) {
  const map = new Map<string, string[]>();
  cards.forEach((card) => {
    const title = normalizeConceptTitle(card.title, DEFAULT_CONCEPT_TITLE);
    const keywords = Array.from(new Set((card.keywords || []).map((keyword) => cleanKnowledgeSentence(keyword)).filter(Boolean))).slice(0, 4);
    if (keywords.length > 0) {
      map.set(title, keywords);
    }
  });
  return map;
}

function buildNotebookMarkdownFromInput(input: {
  targetNode: string;
  markdown?: unknown;
  note?: unknown;
  summary?: unknown;
}, fallbackMarkdown?: unknown) {
  const fallbackText = normalizeKnowledgeMarkdown(String(fallbackMarkdown || ''));
  const sourceMarkdown = normalizeKnowledgeMarkdown(String(input.markdown || ''));
  const baseMap = parseConceptMapFromSummary(fallbackText);
  const existingConcepts = Array.from(baseMap.keys());
  const sourceMap = parseConceptMapFromIncoming({
    ...input,
    markdown: sourceMarkdown,
  }, existingConcepts);
  if (sourceMap.size > 0 || baseMap.size > 0) {
    return renderSummaryFromConceptMap(mergeConceptMaps(baseMap, sourceMap));
  }
  return sourceMarkdown || fallbackText;
}

function buildDrawerWithNotebookMarkdown(
  existing: LearningDrawerContent | undefined,
  targetNode: string,
  markdown: string,
  report?: LearningDrawerContent['last_sync_report'],
) {
  const normalizedMarkdown = buildNotebookMarkdownFromInput({ targetNode, markdown });
  const conceptMap = parseConceptMapFromSummary(normalizedMarkdown);
  const keywordCards = buildKeywordCardsFromConceptMap(conceptMap);
  const summary = renderCompactSummaryFromKeywordCards(keywordCards);
  return {
    ...(existing || {}),
    title: existing?.title || targetNode,
    markdown: normalizedMarkdown,
    summary,
    keyword_cards: keywordCards,
    ...(report ? { last_sync_report: report } : {}),
  } satisfies LearningDrawerContent;
}

export function buildTipsFromKnowledgeSummary(summary: unknown) {
  const map = parseConceptMapFromSummary(summary);
  const tips: string[] = [];
  map.forEach((concept, key) => {
    const first = concept[0];
    if (first) {
      tips.push(`${key}：${first}`);
    }
  });
  return Array.from(new Set(tips)).slice(0, 12);
}

export function buildTipsFromKeywordCards(cards: unknown) {
  return normalizeKeywordCards(cards)
    .flatMap((card) => card.keywords.map((keyword) => `${card.title}：${keyword}`))
    .slice(0, 12);
}

function normalizeLearningDrawerContentInternal(tag: string, content?: LearningDrawerContent) {
  const current = content || {};
  const normalized = buildDrawerWithNotebookMarkdown(current, tag, String(current.markdown || current.summary || ''));
  const changed = JSON.stringify({
    title: current.title || '',
    summary: current.summary || '',
    markdown: normalizeKnowledgeMarkdown(String(current.markdown || '')),
    keyword_cards: current.keyword_cards || [],
  }) !== JSON.stringify({
    title: normalized.title || '',
    summary: normalized.summary || '',
    markdown: normalizeKnowledgeMarkdown(String(normalized.markdown || '')),
    keyword_cards: normalized.keyword_cards || [],
  });
  return { content: normalized, changed };
}

function normalizeLearningContentStateInternal(state: LearningContentState) {
  const next: LearningContentState = { tipsByNode: {}, drawerByTag: {} };
  let changed = false;
  const sourceDrawer = state.drawerByTag || {};
  Object.entries(sourceDrawer).forEach(([tag, content]) => {
    const normalized = normalizeLearningDrawerContentInternal(tag, content);
    next.drawerByTag[tag] = normalized.content;
    const cardTips = buildTipsFromKeywordCards(normalized.content.keyword_cards);
    const fallbackTips = buildTipsFromKnowledgeSummary(normalized.content.summary);
    next.tipsByNode[tag] = Array.from(new Set([...(cardTips || []), ...(fallbackTips || [])])).slice(0, 12);
    if (normalized.changed) changed = true;
  });
  Object.keys(state.tipsByNode || {}).forEach((tag) => {
    if (!next.tipsByNode[tag]) {
      next.tipsByNode[tag] = Array.isArray(state.tipsByNode[tag]) ? [...state.tipsByNode[tag]] : [];
    }
  });
  if (JSON.stringify(next.tipsByNode) !== JSON.stringify(state.tipsByNode || {})) changed = true;
  return { state: next, changed };
}

export function mergeLearningDrawerContent(
  existing: LearningDrawerContent | undefined,
  input: {
    targetNode: string;
    markdown?: unknown;
    note?: unknown;
    summary?: unknown;
    reason?: unknown;
    decision?: LearningSyncDecision;
    questionCount?: number;
    syncedAt?: Date | number;
    source?: 'ai_update' | 'mistake_sync';
  },
): LearningSyncResult {
  const current = existing || {};
  const existingMarkdown = buildNotebookMarkdownFromInput({ targetNode: input.targetNode, markdown: current.markdown });
  const syncedAtDate = input.syncedAt instanceof Date
    ? input.syncedAt
    : typeof input.syncedAt === 'number'
    ? new Date(input.syncedAt)
    : new Date();
  const source = input.source || (input.markdown ? 'ai_update' : 'mistake_sync');
  const reasonText = String(input.reason || '').trim();

  const incomingMarkdown = input.markdown
    ? normalizeKnowledgeMarkdown(String(input.markdown || ''))
    : buildNotebookMarkdownFromInput({
      targetNode: input.targetNode,
      note: input.note,
      summary: input.summary,
    }, existingMarkdown);

  if (!incomingMarkdown) {
    const skipReason = reasonText || '无可写入的知识点内容，保持现状';
    return {
      decision: 'skip',
      reason: skipReason,
      drawer: buildDrawerWithNotebookMarkdown(current, input.targetNode, existingMarkdown, {
        decision: 'skip',
        reason: skipReason,
        synced_at: syncedAtDate.toISOString(),
        source,
        question_count: Math.max(1, Number(input.questionCount || 1)),
      }),
    };
  }

  const existingNormalized = normalizeForKnowledgeDedup(existingMarkdown);
  const incomingNormalized = normalizeForKnowledgeDedup(incomingMarkdown);
  const decision = input.decision || (
    !existingNormalized
      ? 'create'
      : existingNormalized === incomingNormalized
      ? 'skip'
      : 'rewrite'
  );
  const fallbackReason = decision === 'create'
    ? '建议新增首份知识点内容'
    : decision === 'rewrite'
    ? '建议重写并整理已有知识点内容'
    : '现有知识点已覆盖本次信息，无需更新';
  const nextMarkdown = decision === 'skip' ? existingMarkdown : incomingMarkdown;

  return {
    decision,
    reason: reasonText || fallbackReason,
    drawer: buildDrawerWithNotebookMarkdown(current, input.targetNode, nextMarkdown, {
      decision,
      reason: reasonText || fallbackReason,
      next_markdown: decision === 'skip' ? undefined : nextMarkdown,
      synced_at: syncedAtDate.toISOString(),
      source,
      question_count: Math.max(1, Number(input.questionCount || 1)),
    }),
  };
}

function normalizeForKnowledgeDedup(raw: string) {
  return String(raw || '').replace(/\s+/g, '').replace(/[`*_>#\-|]/g, '').toLowerCase();
}

export function mergeKnowledgeDeltaIntoDrawer(
  existing: LearningDrawerContent | undefined,
  input: {
    targetNode: string;
    markdown?: unknown;
    decision?: LearningSyncDecision;
    reason?: unknown;
    questionCount?: number;
    syncedAt?: Date | number;
  },
): LearningSyncResult {
  return mergeLearningDrawerContent(existing, {
    targetNode: input.targetNode,
    markdown: input.markdown,
    decision: input.decision,
    reason: input.reason,
    questionCount: input.questionCount,
    syncedAt: input.syncedAt,
    source: 'draft_review_batch',
  });
}

export type KnowledgeMarkdownDiffLine = {
  type: 'unchanged' | 'removed' | 'added';
  content: string;
}

function toKnowledgeDiffLines(raw: string) {
  const normalized = normalizeKnowledgeMarkdown(raw);
  if (!normalized) return [] as string[];
  return normalized.split('\n');
}

export function buildKnowledgeMarkdownDiff(existingMarkdown: string, nextMarkdown: string): KnowledgeMarkdownDiffLine[] {
  const before = toKnowledgeDiffLines(existingMarkdown);
  const after = toKnowledgeDiffLines(nextMarkdown);
  if (before.length === 0 && after.length === 0) return [];
  if (before.length === 0) {
    return after.map((content) => ({ type: 'added' as const, content }));
  }
  if (after.length === 0) {
    return before.map((content) => ({ type: 'removed' as const, content }));
  }

  const dp = Array.from({ length: before.length + 1 }, () => Array(after.length + 1).fill(0));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      dp[i][j] = before[i] === after[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const diff: KnowledgeMarkdownDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      diff.push({ type: 'unchanged', content: before[i] });
      i += 1;
      j += 1;
      continue;
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      diff.push({ type: 'removed', content: before[i] });
      i += 1;
      continue;
    }
    diff.push({ type: 'added', content: after[j] });
    j += 1;
  }
  while (i < before.length) {
    diff.push({ type: 'removed', content: before[i] });
    i += 1;
  }
  while (j < after.length) {
    diff.push({ type: 'added', content: after[j] });
    j += 1;
  }
  return diff;
}

export function buildKnowledgeMarkdownFromData(data: { title?: string; summary?: string; tables?: any[] }, tag: string) {
  const lines: string[] = [];
  if (data.summary) {
    lines.push(data.summary);
  }
  if (Array.isArray(data.tables) && data.tables.length > 0) {
    data.tables.forEach((table: any) => {
      lines.push('');
      lines.push(`### ${table.title || '知识点速查表'}`);
      lines.push('');
      if (table.type === 'definition' && Array.isArray(table.data)) {
        table.data.forEach((item: any) => {
          lines.push(`- **${item.name || '概念'}**：${item.desc || ''}`);
        });
      }
      if (table.type === 'matrix' && Array.isArray(table.columns) && Array.isArray(table.data)) {
        lines.push(`| ${table.columns.join(' | ')} |`);
        lines.push(`| ${table.columns.map(() => '---').join(' | ')} |`);
        table.data.forEach((row: string[]) => {
          lines.push(`| ${row.join(' | ')} |`);
        });
      }
    });
  }
  return buildNotebookMarkdownFromInput({ targetNode: tag, markdown: lines.join('\n') });
}

export function getMergedKnowledgeContent(tag: string, drawerOverrides: Record<string, LearningDrawerContent>) {
  const override = drawerOverrides[tag] || {};
  let baseMarkdown = '';
  const defaultData = KNOWLEDGE_DB[tag] || KNOWLEDGE_DB.default;
  if (defaultData) {
    if (defaultData.markdown) {
      baseMarkdown = defaultData.markdown;
    } else {
      baseMarkdown = buildKnowledgeMarkdownFromData(defaultData, tag);
    }
  }
  const overrideMarkdown = buildNotebookMarkdownFromInput({ targetNode: tag, markdown: override.markdown || '' });
  
  return {
    title: override.title || tag,
    markdown: overrideMarkdown || buildNotebookMarkdownFromInput({ targetNode: tag, markdown: baseMarkdown }),
  };
}

export async function runLearningContentCleanup() {
  const remote = await userLearningStateApi.get();
  const source = (remote.learning_content || { tipsByNode: {}, drawerByTag: {} }) as LearningContentState;
  return { checked: 0, updated: 0 };
}
