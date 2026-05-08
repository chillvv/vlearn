import { questionsApi } from './api';
import { getKnowledgeNodeMeta, registerCustomKnowledgeTaxonomy, removeCustomKnowledgeTaxonomy, renameCustomKnowledgeTaxonomy } from './knowledgeTaxonomy';
import type { Question, Subject } from './types';

type TagTreeMutationInput = {
  subject: Subject;
  questions: Question[];
};

export async function moveNodeTag(input: TagTreeMutationInput & {
  nodeValue: string;
  targetCategory: string;
}) {
  const node = String(input.nodeValue || '').trim();
  const category = String(input.targetCategory || '').trim();
  if (!node || !category) return;

  const meta = getKnowledgeNodeMeta(input.subject, node);
  if (meta.category === category) return;

  await registerCustomKnowledgeTaxonomy(node, category, meta.branch || '默认分类', input.subject);
  const affectedIds = input.questions.filter((q) => q.knowledge_point === node).map((q) => q.id);
  if (affectedIds.length > 0) {
    await questionsApi.batchUpdate(affectedIds, {
      knowledge_point: node,
      category,
      ability: meta.branch,
      node,
    });
  }
}

export async function renameNodeTag(input: TagTreeMutationInput & {
  oldValue: string;
  nextValue: string;
}) {
  const oldValue = String(input.oldValue || '').trim();
  const nextValue = String(input.nextValue || '').trim();
  if (!oldValue || !nextValue || oldValue === nextValue) return;

  await renameCustomKnowledgeTaxonomy(oldValue, nextValue, input.subject);
  const affectedIds = input.questions.filter((q) => q.knowledge_point === oldValue).map((q) => q.id);
  if (affectedIds.length > 0) {
    const meta = getKnowledgeNodeMeta(input.subject, nextValue);
    await questionsApi.batchUpdate(affectedIds, {
      knowledge_point: nextValue,
      category: meta.category,
      ability: meta.branch,
      node: meta.node,
    });
  }
}

export async function syncDeleteNodeTag(input: TagTreeMutationInput & {
  value: string;
  fallback: string;
}) {
  const value = String(input.value || '').trim();
  const fallback = String(input.fallback || '').trim();
  if (!value || !fallback) return;
  await removeCustomKnowledgeTaxonomy(value, input.subject);
  const affectedIds = input.questions.filter((q) => q.knowledge_point === value).map((q) => q.id);
  if (affectedIds.length > 0) {
    const meta = getKnowledgeNodeMeta(input.subject, fallback);
    await questionsApi.batchUpdate(affectedIds, {
      knowledge_point: fallback,
      category: meta.category,
      ability: meta.branch,
      node: meta.node,
    });
  }
}

export async function syncDeleteCategory(input: TagTreeMutationInput & {
  nodesToDelete: string[];
  fallback: string;
}) {
  const fallback = String(input.fallback || '').trim();
  const nodesToDelete = Array.from(new Set((input.nodesToDelete || []).map((node) => String(node || '').trim()).filter(Boolean)));
  if (!fallback || nodesToDelete.length === 0) return;
  await Promise.all(nodesToDelete.map((node) => removeCustomKnowledgeTaxonomy(node, input.subject)));
  const affectedIds = input.questions
    .filter((q) => nodesToDelete.includes(String(q.knowledge_point || '').trim()))
    .map((q) => q.id);
  if (affectedIds.length > 0) {
    const meta = getKnowledgeNodeMeta(input.subject, fallback);
    await questionsApi.batchUpdate(affectedIds, {
      knowledge_point: fallback,
      category: meta.category,
      ability: meta.branch,
      node: meta.node,
    });
  }
}
