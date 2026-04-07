import { knowledgeNodesApi, taxonomyApi } from './api';
import type { Subject } from './types';

export type KnowledgeNodeMeta = {
  category: string;
  branch: string;
  node: string;
};

const DEFAULT_NODE: KnowledgeNodeMeta = {
  category: '未分类',
  branch: '其他',
  node: '其他',
};

type SubjectTaxonomyMap = Record<Subject, Record<string, KnowledgeNodeMeta>>;
const runtimeTaxonomyMap: SubjectTaxonomyMap = { 英语: {}, C语言: {} };

function getTaxonomyMap(subject: Subject) {
  return runtimeTaxonomyMap[subject];
}

export function getKnowledgeNodeMeta(subject: Subject, knowledgePoint?: string): KnowledgeNodeMeta {
  if (!knowledgePoint) return DEFAULT_NODE;
  const trimmed = knowledgePoint.trim();
  const meta = getTaxonomyMap(subject)[trimmed];
  if (meta) return meta;
  return { category: `${subject}其他`, branch: '未分类', node: trimmed };
}

export function isKnowledgePointInSubjectTaxonomy(subject: Subject, knowledgePoint: string): boolean {
  return Boolean(getTaxonomyMap(subject)[knowledgePoint]);
}

export function getKnowledgePointsBySubjectFromTaxonomy(subject: Subject): string[] {
  return Object.keys(getTaxonomyMap(subject));
}

export function inferKnowledgeNodeMetaForNewTag(subject: Subject, knowledgePoint: string): KnowledgeNodeMeta {
  const normalizedPoint = String(knowledgePoint || '').trim();
  if (!normalizedPoint) return { category: `${subject}自定义`, branch: '未分类', node: knowledgePoint };
  const existing = getTaxonomyMap(subject)[normalizedPoint];
  if (existing) return existing;
  const bySimilarity = inferBySimilarity(subject, normalizedPoint);
  if (bySimilarity) return { category: bySimilarity.category, branch: bySimilarity.branch, node: normalizedPoint };
  const byKeyword = inferByKeyword(subject, normalizedPoint);
  if (byKeyword) return { category: byKeyword.category, branch: '未分类', node: normalizedPoint };
  return { category: `${subject}自定义`, branch: '未分类', node: normalizedPoint };
}

export async function registerCustomKnowledgeTaxonomy(knowledgePoint: string, category: string, branch: string, subject: Subject) {
  const normalizedPoint = String(knowledgePoint || '').trim();
  const normalizedCategory = String(category || '').trim();
  const normalizedBranch = String(branch || '').trim() || '未分类';
  if (!normalizedPoint || !normalizedCategory) return;
  const current = getTaxonomyMap(subject);
  const previous = current[normalizedPoint];
  const normalized = { category: normalizedCategory, branch: normalizedBranch, node: normalizedPoint };
  current[normalizedPoint] = normalized;
  try {
    await taxonomyApi.upsertKnowledgePoint({
      subject,
      knowledgePoint: normalizedPoint,
      category: normalizedCategory,
      branch: normalizedBranch,
    });
  } catch (error) {
    if (previous) current[normalizedPoint] = previous;
    else delete current[normalizedPoint];
    throw error;
  }
}

export async function renameCustomKnowledgeTaxonomy(oldKnowledgePoint: string, newKnowledgePoint: string, subject: Subject) {
  if (!oldKnowledgePoint || !newKnowledgePoint || oldKnowledgePoint === newKnowledgePoint) return;
  const current = getTaxonomyMap(subject);
  const oldMeta = current[oldKnowledgePoint] || getKnowledgeNodeMeta(subject, oldKnowledgePoint);
  await registerCustomKnowledgeTaxonomy(newKnowledgePoint, oldMeta.category, oldMeta.branch, subject);
  await removeCustomKnowledgeTaxonomy(oldKnowledgePoint, subject, oldMeta.category);
}

export async function removeCustomKnowledgeTaxonomy(knowledgePoint: string, subject: Subject, category?: string) {
  const current = getTaxonomyMap(subject);
  const previous = current[knowledgePoint];
  delete current[knowledgePoint];
  try {
    await knowledgeNodesApi.deleteNode(subject, knowledgePoint, category || previous?.category);
  } catch (error) {
    if (previous) current[knowledgePoint] = previous;
    throw error;
  }
}

export async function hydrateTaxonomyOverridesFromCloud() {
  if (typeof window === 'undefined') return;
  try {
    const nodes = await knowledgeNodesApi.getAll().catch(() => []);
    replaceTaxonomyMapFromNodes(nodes);
  } catch {
    runtimeTaxonomyMap.英语 = {};
    runtimeTaxonomyMap.C语言 = {};
  }
}

export async function persistTaxonomyOverridesToCloud() {
}

function replaceTaxonomyMapFromNodes(nodes: Array<any>) {
  runtimeTaxonomyMap.英语 = {};
  runtimeTaxonomyMap.C语言 = {};
  nodes.forEach((item) => {
    const subject = item.subject === 'C语言' ? 'C语言' : item.subject === '英语' ? '英语' : null;
    if (!subject) return;
    const node = String(item.node || item.tag_name || '').trim();
    const category = String(item.category || '').trim() || '未分类';
    const branch = String(item.branch || '').trim() || '其他';
    if (!node) return;
    runtimeTaxonomyMap[subject][node] = {
      category,
      branch,
      node,
    };
  });
}

function inferBySimilarity(subject: Subject, knowledgePoint: string): KnowledgeNodeMeta | null {
  const entries = Object.entries(getTaxonomyMap(subject));
  let best: { score: number; meta: KnowledgeNodeMeta } | null = null;
  entries.forEach(([node, meta]) => {
    const score = computeSimilarityScore(knowledgePoint, node);
    if (!best || score > best.score) {
      best = { score, meta };
    }
  });
  if (!best || best.score < 4) return null;
  return best.meta;
}

function computeSimilarityScore(a: string, b: string) {
  const left = a.trim();
  const right = b.trim();
  if (!left || !right) return 0;
  if (left === right) return 100;
  if (left.includes(right) || right.includes(left)) return 60 + Math.min(left.length, right.length);
  const leftChars = new Set(left.split(''));
  const shared = right.split('').filter(char => leftChars.has(char)).length;
  const prefix = getCommonPrefixLen(left, right);
  return shared * 2 + prefix * 3;
}

function getCommonPrefixLen(a: string, b: string) {
  const max = Math.min(a.length, b.length);
  let idx = 0;
  while (idx < max && a[idx] === b[idx]) idx += 1;
  return idx;
}

function inferByKeyword(subject: Subject, knowledgePoint: string): { category: string } | null {
  const text = knowledgePoint.trim();
  if (!text) return null;
  const matched = (subject === '英语' ? ENGLISH_KEYWORD_HINTS : C_KEYWORD_HINTS).find(item => item.pattern.test(text));
  if (!matched) return null;
  return { category: matched.category };
}

const ENGLISH_KEYWORD_HINTS: Array<{ pattern: RegExp; category: string }> = [];

const C_KEYWORD_HINTS: Array<{ pattern: RegExp; category: string }> = [];
