import { userLearningStateApi } from './api';
import type { LearningContentState, LearningDrawerContent } from './types';
export type { LearningContentState, LearningDrawerContent } from './types';

export const LEARNING_CONTENT_KEY = 'mistake_learning_content_v1';

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

export function readLearningContentState(): LearningContentState {
  clearLegacyLearningContentCache();
  return cloneLearningContentState(learningContentMemoryState);
}

export function writeLearningContentState(next: LearningContentState) {
  clearLegacyLearningContentCache();
  learningContentMemoryState = cloneLearningContentState(next);
  void persistLearningContentState(next);
}

export async function hydrateLearningContentStateFromCloud() {
  if (typeof window === 'undefined') return cloneLearningContentState(learningContentMemoryState);
  clearLegacyLearningContentCache();
  try {
    const remote = await userLearningStateApi.get();
    learningContentMemoryState = cloneLearningContentState(remote.learning_content || { tipsByNode: {}, drawerByTag: {} });
    return cloneLearningContentState(learningContentMemoryState);
  } catch {
    learningContentMemoryState = { tipsByNode: {}, drawerByTag: {} };
    return cloneLearningContentState(learningContentMemoryState);
  }
}

export async function persistLearningContentState(state?: LearningContentState) {
  if (typeof window === 'undefined') return;
  clearLegacyLearningContentCache();
  const payload = cloneLearningContentState(state || learningContentMemoryState);
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

export function mergeLearningDrawerContent(
  existing: LearningDrawerContent | undefined,
  input: {
    targetNode: string;
    markdown?: unknown;
    note?: unknown;
    summary?: unknown;
  },
) {
  const current = existing || {};
  
  // 如果直接提供了新的 markdown (如 update_learning_content 动作)，则直接覆盖重写
  if (input.markdown) {
    return {
      ...current,
      title: current.title || input.targetNode,
      markdown: normalizeKnowledgeMarkdown(String(input.markdown)),
    };
  }

  // 如果没有直接提供 markdown（例如只是错题同步），我们通过追加的方式将新的 note 融入到现有内容底部
  let newMarkdown = current.markdown || '';
  const noteText = normalizeKnowledgeMarkdown(String(input.note || ''));
  const summaryText = normalizeKnowledgeMarkdown(String(input.summary || ''));
  
  if (noteText || summaryText) {
    const lines = [];
    if (newMarkdown) lines.push(newMarkdown);
    lines.push('\n---\n');
    lines.push('### 新增错题沉淀');
    if (summaryText) lines.push(summaryText);
    if (noteText) lines.push(noteText);
    newMarkdown = normalizeKnowledgeMarkdown(lines.join('\n'));
  }

  return {
    ...current,
    title: current.title || input.targetNode,
    markdown: newMarkdown,
  };
}

export function getMergedKnowledgeContent(tag: string, drawerOverrides: Record<string, LearningDrawerContent>) {
  const override = drawerOverrides[tag] || {};
  return {
    title: override.title || tag,
    markdown: normalizeKnowledgeMarkdown(override.markdown || ''),
  };
}

export async function runLearningContentCleanup() {
  // 不再做自动化的“魔法”重构，只做简单的读取，把之前可能混杂的数据格式清掉
  const remote = await userLearningStateApi.get();
  const source = (remote.learning_content || { tipsByNode: {}, drawerByTag: {} }) as LearningContentState;
  return source;
}
