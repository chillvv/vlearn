import { ABILITIES, ENGLISH_KNOWLEDGE_POINTS, PROGRAMMING_KNOWLEDGE_POINTS, getErrorTypesBySubject } from './types';

type Subject = '英语' | 'C语言';

type NormalizeQuestionTagsInput = {
  subject?: string;
  knowledgePoint?: string;
  ability?: string;
  errorType?: string;
};

type CanonicalTags = {
  subject: Subject;
  knowledgePoint: string;
  ability: string;
  errorType: string;
};

const ENGLISH_SET = new Set(ENGLISH_KNOWLEDGE_POINTS);
const PROGRAMMING_SET = new Set(PROGRAMMING_KNOWLEDGE_POINTS);
const ENGLISH_ERROR_SET = new Set(getErrorTypesBySubject('英语'));
const PROGRAMMING_ERROR_SET = new Set(getErrorTypesBySubject('C语言'));

const KNOWLEDGE_TO_ERROR: Record<Subject, Record<string, string>> = {
  英语: {
    主旨理解: '阅读主旨',
    细节理解: '阅读细节',
    推理判断: '阅读推理',
    表达准确: '写作表达',
  },
  C语言: {
    变量与数据类型: '数据类型',
    运算符与表达式: '运算表达式',
    选择结构: '分支循环',
    循环结构: '分支循环',
    函数: '函数调用',
    排序与查找: '排序查找',
  },
};

const ERROR_TO_KNOWLEDGE: Record<Subject, Record<string, string>> = {
  英语: {
    阅读主旨: '主旨理解',
    阅读细节: '细节理解',
    阅读推理: '推理判断',
    写作表达: '表达准确',
  },
  C语言: {
    数据类型: '变量与数据类型',
    运算表达式: '运算符与表达式',
    分支循环: '选择结构',
    函数调用: '函数',
    排序查找: '排序与查找',
  },
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
  if (ENGLISH_SET.has(tag)) return '英语';
  if (PROGRAMMING_SET.has(tag)) return 'C语言';
  if (tag.match(/时态|主谓|从句|语态|介词|冠词|代词|阅读|写作|翻译|词/)) return '英语';
  return 'C语言';
}

function normalizeKnowledgePoint(subject: Subject, knowledgePoint?: string, errorType?: string): string {
  const rawKnowledge = String(knowledgePoint || '').trim();
  const subjectKnowledge = subject === '英语' ? ENGLISH_KNOWLEDGE_POINTS : PROGRAMMING_KNOWLEDGE_POINTS;
  if (!rawKnowledge) {
    const mapped = ERROR_TO_KNOWLEDGE[subject][String(errorType || '').trim()];
    return mapped || subjectKnowledge[0];
  }
  if (subjectKnowledge.includes(rawKnowledge)) return rawKnowledge;
  const mappedByError = ERROR_TO_KNOWLEDGE[subject][rawKnowledge];
  if (mappedByError) return mappedByError;
  // If it's a custom tag or an unknown tag, just return it as is instead of destroying it
  return rawKnowledge;
}

function normalizeAbility(ability?: string): string {
  const raw = String(ability || '').trim();
  if (ABILITIES.includes(raw)) return raw;
  if (!raw) return '规则应用';
  if (raw.match(/定位|识别|找出/)) return '知识点定位';
  if (raw.match(/规则|迁移|套用/)) return '规则应用';
  if (raw.match(/步骤|推导|执行|计算/)) return '步骤执行';
  if (raw.match(/表达|输出|组织|书写/)) return '表达输出';
  return raw;
}

function normalizeErrorType(subject: Subject, errorType?: string, knowledgePoint?: string): string {
  const rawError = String(errorType || '').trim();
  const tags = getErrorTypesBySubject(subject);
  const tagSet = subject === '英语' ? ENGLISH_ERROR_SET : PROGRAMMING_ERROR_SET;
  if (rawError && tagSet.has(rawError)) return rawError;
  // If it's a custom tag or an unknown tag, just return it as is
  if (rawError) return rawError;

  const mappedErrorByKnowledge = KNOWLEDGE_TO_ERROR[subject][String(knowledgePoint || '').trim()];
  if (mappedErrorByKnowledge) return mappedErrorByKnowledge;
  const mappedErrorByRawError = KNOWLEDGE_TO_ERROR[subject][rawError];
  if (mappedErrorByRawError) return mappedErrorByRawError;
  if (String(knowledgePoint || '').trim() && tagSet.has(String(knowledgePoint || '').trim())) return String(knowledgePoint || '').trim();
  return tags[0] || String(knowledgePoint || '').trim() || (subject === '英语' ? '时态' : '数据类型');
}

export function normalizeQuestionTags(input: NormalizeQuestionTagsInput): CanonicalTags {
  const preferredSubject = asSubject(input.subject);
  const inferredByKnowledge = inferSubjectByKnowledgePoint(input.knowledgePoint);
  const subject = preferredSubject || inferredByKnowledge;
  const knowledgePoint = normalizeKnowledgePoint(subject, input.knowledgePoint, input.errorType);
  const ability = normalizeAbility(input.ability);
  const errorType = normalizeErrorType(subject, input.errorType, knowledgePoint);
  return {
    subject,
    knowledgePoint,
    ability,
    errorType,
  };
}
