import { parseQuestionPreview } from './questionPreview';

export type QuestionType = 'choice' | 'fill' | 'essay' | 'judge' | 'mixed';
export type ValidationStatus = 'valid' | 'invalid';
export type RenderMode = 'structured' | 'fallback';

export interface QuestionChoiceOption {
  label: string;
  text: string;
}

export interface QuestionContentBlock {
  type: 'stem' | 'option' | 'paragraph';
  text: string;
  label?: string;
}

export interface QuestionAnswerSchema {
  type: 'single' | 'text';
  correctAnswer?: string;
  acceptableAnswers?: string[];
}

export interface QuestionNormalizedPayload {
  version: 'v1';
  questionType: QuestionType;
  contentBlocks: QuestionContentBlock[];
  options: QuestionChoiceOption[];
  answerSchema: QuestionAnswerSchema;
  explanation?: string;
}

function toText(input: unknown) {
  return String(input || '').replace(/\r\n/g, '\n').replace(/\\n/g, '\n').trim();
}

function normalizeText(input: string) {
  return input.replace(/\s+/g, ' ').trim();
}

function normalizeQuestionType(input: unknown, fallback: QuestionType): QuestionType {
  const raw = String(input || '').trim().toLowerCase();
  if (raw === 'choice' || raw === 'fill' || raw === 'essay' || raw === 'judge' || raw === 'mixed') return raw;
  if (raw === 'blank') return 'fill';
  if (raw === 'general') return fallback;
  return fallback;
}

export function normalizeCorrectAnswer(raw: string, options: QuestionChoiceOption[]) {
  const compact = normalizeText(raw);
  if (!compact) return '';
  
  // First, check if the raw text matches an option's text exactly
  const matchByText = options.find((item) => normalizeText(item.text) === compact);
  if (matchByText) return matchByText.label;
  
  // Check if it matches A-H exactly, or A., B. etc.
  const exactLetterMatch = compact.match(/^([A-H])(\.|、|:)?$/i);
  if (exactLetterMatch) return exactLetterMatch[1].toUpperCase();
  
  // Check if it starts with A-H followed by dot/space and option text
  const prefixMatch = compact.match(/^([A-H])[\.\s、:]/i);
  if (prefixMatch) return prefixMatch[1].toUpperCase();

  // If it's a single word and matches A-H
  if (compact.length === 1 && compact.match(/[A-H]/i)) {
    return compact.toUpperCase();
  }

  return compact;
}

export function buildNormalizedQuestionPayload(params: {
  questionText?: string;
  optionsInput?: string[];
  questionTypeHint?: string;
  correctAnswer?: string;
  explanation?: string;
}): QuestionNormalizedPayload {
  const parsed = parseQuestionPreview(params.questionText || '');
  const inferredType = parsed.options.length >= 2 ? 'choice' : parsed.kind === 'blank' ? 'fill' : parsed.kind === 'judge' ? 'judge' : 'essay';
  const questionType = normalizeQuestionType(params.questionTypeHint, inferredType);
  const fromInput = (params.optionsInput || [])
    .map((item) => parseQuestionPreview(item).options[0] || null)
    .filter((item): item is QuestionChoiceOption => Boolean(item));
  const options = (fromInput.length > 0 ? fromInput : parsed.options)
    .filter((item, index, arr) => arr.findIndex((target) => target.label === item.label) === index);
  const stem = normalizeText(parsed.stem || toText(params.questionText || '') || '未填写题目内容');
  const blocks: QuestionContentBlock[] = [{ type: 'stem', text: stem }];
  if (questionType === 'choice') {
    options.forEach((item) => blocks.push({ type: 'option', label: item.label, text: normalizeText(item.text) }));
  }
  const normalizedAnswer = normalizeCorrectAnswer(params.correctAnswer || '', options);
  const answerSchema: QuestionAnswerSchema = questionType === 'choice'
    ? { type: 'single', correctAnswer: normalizedAnswer || undefined }
    : {
      type: 'text',
      correctAnswer: normalizeText(params.correctAnswer || '') || undefined,
      acceptableAnswers: (params.correctAnswer || '')
        .split('|')
        .map((item) => normalizeText(item))
        .filter(Boolean),
    };
  return {
    version: 'v1',
    questionType,
    contentBlocks: blocks,
    options,
    answerSchema,
    explanation: toText(params.explanation || ''),
  };
}

export function validateNormalizedQuestionPayload(payload: QuestionNormalizedPayload) {
  const errors: string[] = [];
  if (!payload || payload.version !== 'v1') errors.push('invalid_version');
  if (!payload.contentBlocks?.some((item) => item.type === 'stem' && normalizeText(item.text).length > 0)) errors.push('missing_stem');
  if (payload.questionType === 'choice') {
    if (!Array.isArray(payload.options) || payload.options.length < 2) errors.push('choice_missing_options');
    if (payload.answerSchema.type !== 'single') errors.push('choice_invalid_answer_schema');
  }
  if (payload.questionType !== 'choice' && payload.answerSchema.type !== 'text') errors.push('non_choice_invalid_answer_schema');
  return { valid: errors.length === 0, errors };
}

export function normalizeValidationStatus(valid: boolean): ValidationStatus {
  return valid ? 'valid' : 'invalid';
}

export function deriveRenderMode(validationStatus: ValidationStatus): RenderMode {
  return validationStatus === 'valid' ? 'structured' : 'fallback';
}

export function parseStoredNormalizedPayload(value: unknown): QuestionNormalizedPayload | null {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object') return null;
    const payload = parsed as QuestionNormalizedPayload;
    if (payload.version !== 'v1' || !Array.isArray(payload.contentBlocks)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getStemFromPayload(payload: QuestionNormalizedPayload) {
  return payload.contentBlocks.find((item) => item.type === 'stem')?.text || '未填写题目内容';
}
