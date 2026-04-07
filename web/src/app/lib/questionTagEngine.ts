import { ENGLISH_KNOWLEDGE_POINTS, PROGRAMMING_KNOWLEDGE_POINTS } from './types';

type Subject = '英语' | 'C语言';

type NormalizeQuestionTagsInput = {
  subject?: string;
  knowledgePoint?: string;
};

type CanonicalTags = {
  subject: Subject;
  knowledgePoint: string;
  ability: string;
  errorType: string;
};

function asSubject(value?: string): Subject | null {
  const raw = String(value || '').trim();
  if (raw === '英语') return '英语';
  if (raw === 'C语言') return 'C语言';
  if (raw.match(/^(英文|english)$/i)) return '英语';
  if (raw.match(/^(c|c语言程序设计|程序设计|编程|计算机)$/i)) return 'C语言';
  return null;
}

function inferSubjectByKnowledgePoint(knowledgePoint?: string): Subject {
  const tag = String(knowledgePoint || '').trim();
  if (getSubjectKnowledgeList('英语').includes(tag)) return '英语';
  if (getSubjectKnowledgeList('C语言').includes(tag)) return 'C语言';
  return '英语'; // Default fallback
}

function getSubjectKnowledgeList(subject: Subject) {
  const source = subject === '英语' ? ENGLISH_KNOWLEDGE_POINTS : PROGRAMMING_KNOWLEDGE_POINTS;
  return source;
}

function normalizeKnowledgePoint(subject: Subject, knowledgePoint?: string): string {
  const rawKnowledge = String(knowledgePoint || '').trim();
  const subjectKnowledge = getSubjectKnowledgeList(subject);
  if (!rawKnowledge) return '';
  if (subjectKnowledge.includes(rawKnowledge)) return rawKnowledge;
  return rawKnowledge;
}

export function normalizeQuestionTags(input: NormalizeQuestionTagsInput): CanonicalTags {
  const preferredSubject = asSubject(input.subject);
  const inferredByKnowledge = inferSubjectByKnowledgePoint(input.knowledgePoint);
  const subject = preferredSubject || inferredByKnowledge;
  const knowledgePoint = normalizeKnowledgePoint(subject, input.knowledgePoint);
  return {
    subject,
    knowledgePoint,
    ability: '',
    errorType: '',
  };
}
