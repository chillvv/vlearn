import type { Question } from './types';
import { formatQuestionTextForStorage, parseQuestionPreview } from './questionPreview';
import { getKnowledgePointsBySubjectFromTaxonomy } from './knowledgeTaxonomy';

export type DraftQuestionForImport = Partial<Question> & { options?: string[] };

export function resolveDraftOptionLines(draft: DraftQuestionForImport) {
  if (Array.isArray(draft.options) && draft.options.length > 0) {
    return draft.options.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (Array.isArray(draft.normalized_payload?.options) && draft.normalized_payload.options.length > 0) {
    return draft.normalized_payload.options.map((item) => `${item.label}. ${item.text}`);
  }
  const parsed = parseQuestionPreview(String(draft.question_text || ''));
  return parsed.options.map((item) => `${item.label}. ${item.text}`);
}

export function buildDraftPreviewTextForStorage(draft: DraftQuestionForImport) {
  const stem = String(draft.question_text || '').trim();
  const optionLines = resolveDraftOptionLines(draft);
  if (optionLines.length === 0) return stem;
  return formatQuestionTextForStorage(stem, optionLines);
}

export function validateDraftsBeforeImportPolicy(items: DraftQuestionForImport[]) {
  const issues: string[] = [];
  items.forEach((draft, index) => {
    const label = `第 ${index + 1} 题`;
    const questionText = String(draft.question_text || '').trim();
    const subject = String(draft.subject || '英语') as '英语' | 'C语言';
    const knowledgePoint = String(draft.knowledge_point || '').trim();
    const validKnowledgePoints = getKnowledgePointsBySubjectFromTaxonomy(subject);
    const optionLines = resolveDraftOptionLines(draft);
    const note = String(draft.note || '').trim();
    if (!questionText) issues.push(`${label}缺少题干，请先补充再入库。`);
    if (!knowledgePoint || !validKnowledgePoints.includes(knowledgePoint)) issues.push(`${label}的知识点必须从标签库中选择。`);
    if ((draft.question_type === 'choice' || optionLines.length > 0) && optionLines.length < 2) issues.push(`${label}是选择题时至少需要 2 个选项。`);
    if (!note) issues.push(`${label}缺少解析/笔记，请先补充再入库。`);
  });
  return issues;
}

export function normalizeDraftForImportPolicy(draft: DraftQuestionForImport) {
  const optionLines = resolveDraftOptionLines(draft);
  const stem = String(draft.question_text || '').trim();
  return {
    ...draft,
    subject: draft.subject === 'C语言' ? 'C语言' : '英语',
    question_text: formatQuestionTextForStorage(stem, optionLines) || stem || '来自 AI 管家会话',
    image_url: draft.image_url || undefined,
    knowledge_point: String(draft.knowledge_point || '').trim(),
    note: String(draft.note || '').trim() || '由 AI 聊天生成',
    summary: String(draft.summary || '').trim(),
    options: optionLines,
    normalized_payload: undefined,
  } satisfies Partial<Question> & { options?: string[] };
}
