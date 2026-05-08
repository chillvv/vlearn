import type { CopilotActionProposal } from './copilot';

type DraftLike = {
  question_text?: string;
};

type QuestionLike = {
  id: string;
  question_text: string;
};

function normalizeQuestionIdentityText(value: unknown) {
  return String(value || '').replace(/[\s\p{P}]/gu, '').toLowerCase();
}

export async function resolveQuestionIdFromActionPayload(input: {
  action: CopilotActionProposal;
  drafts?: DraftLike[];
  getAllQuestions: () => Promise<QuestionLike[]>;
  matchesQuestionIdentifier: (question: QuestionLike, candidate: string) => boolean;
  isUuidLike: (value: string) => boolean;
}) {
  const payload = input.action.payload || {};
  const directCandidates = [
    payload?.question_id,
    payload?.questionId,
    payload?.id,
    payload?.mistake_id,
    payload?.mistakeId,
    Array.isArray(payload?.questions) ? payload.questions[0]?.question_id : undefined,
    Array.isArray(payload?.questions) ? payload.questions[0]?.id : undefined,
  ].map((item) => String(item || '').trim()).filter(Boolean);

  if (directCandidates.length > 0) {
    const target = directCandidates.find((item) => input.isUuidLike(item));
    if (target) return target;
    return directCandidates[0];
  }

  const allQuestions = await input.getAllQuestions();
  const textCandidates = [
    payload?.question_text,
    payload?.questionText,
    Array.isArray(payload?.questions) ? payload.questions[0]?.question_text : undefined,
    Array.isArray(payload?.questions) ? payload.questions[0]?.questionText : undefined,
    input.drafts?.[0]?.question_text,
  ].map((item) => String(item || '').trim()).filter(Boolean);

  for (const candidate of textCandidates) {
    const normalized = normalizeQuestionIdentityText(candidate);
    if (normalized.length < 6) continue;
    const matches = allQuestions.filter((question) => {
      if (directCandidates.some((direct) => input.matchesQuestionIdentifier(question, direct))) return true;
      const target = normalizeQuestionIdentityText(question.question_text);
      if (!target) return false;
      return target.includes(normalized) || normalized.includes(target);
    });
    if (matches.length === 1) return matches[0].id;
  }

  return '';
}
