export type QuestionPreviewKind = 'choice' | 'blank' | 'judge' | 'general';

export interface QuestionOptionPreview {
  label: string;
  text: string;
}

export interface QuestionPreview {
  stem: string;
  options: QuestionOptionPreview[];
  kind: QuestionPreviewKind;
}

const OPTION_LINE_RE = /^([A-Ha-h1-8])[\.．、:：\)）\]]\s*(.+)$/;
const INLINE_OPTION_RE = /([A-Ha-h1-8])[\.．、:：\)）\]]\s*([\s\S]*?)(?=\s+[A-Ha-h1-8][\.．、:：\)）\]]\s*|$)/g;

function normalizeRawText(input: string) {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function compactText(input: string) {
  return input.replace(/\s+/g, ' ').trim();
}

function normalizeOptionLabel(raw: string) {
  const value = raw.toUpperCase();
  if (/^[1-8]$/.test(value)) {
    return String.fromCharCode(64 + Number(value));
  }
  return value;
}

function normalizeOptionText(raw: string) {
  return compactText(raw).replace(/^[\-—–]\s*/, '');
}

function parseInlineOptions(line: string) {
  const options: QuestionOptionPreview[] = [];
  let firstOptionIndex = -1;
  let match: RegExpExecArray | null;
  INLINE_OPTION_RE.lastIndex = 0;
  while ((match = INLINE_OPTION_RE.exec(line)) !== null) {
    if (firstOptionIndex < 0) firstOptionIndex = match.index;
    const label = normalizeOptionLabel(match[1]);
    const text = normalizeOptionText(match[2]);
    if (!text) continue;
    options.push({ label, text });
  }
  if (options.length < 2) return null;
  return {
    stem: compactText(line.slice(0, firstOptionIndex)),
    options,
  };
}

function detectKind(stem: string, options: QuestionOptionPreview[]): QuestionPreviewKind {
  if (options.length >= 2) return 'choice';
  if (/(_{2,}|（\s*）|\(\s*\)|\b_{1,}\b)/.test(stem)) return 'blank';
  if (/判断|true\s*or\s*false|对错|正确|错误/i.test(stem)) return 'judge';
  return 'general';
}

export function parseQuestionPreview(questionText: string): QuestionPreview {
  const normalized = normalizeRawText(questionText || '');
  if (!normalized) {
    return { stem: '未填写题目内容', options: [], kind: 'general' };
  }

  const lines = normalized
    .split('\n')
    .map((line) => compactText(line))
    .filter(Boolean);

  const stemLines: string[] = [];
  const options: QuestionOptionPreview[] = [];

  for (const line of lines) {
    const optionMatch = line.match(OPTION_LINE_RE);
    if (optionMatch) {
      options.push({
        label: normalizeOptionLabel(optionMatch[1]),
        text: normalizeOptionText(optionMatch[2]),
      });
      continue;
    }

    const inlineParsed = parseInlineOptions(line);
    if (inlineParsed) {
      if (inlineParsed.stem) stemLines.push(inlineParsed.stem);
      options.push(...inlineParsed.options);
      continue;
    }

    stemLines.push(line);
  }

  const stem = compactText(stemLines.join(' ')) || compactText(normalized);
  const uniqueOptions = options.filter((opt, index) => options.findIndex((item) => item.label === opt.label) === index);
  const kind = detectKind(stem, uniqueOptions);

  return {
    stem,
    options: uniqueOptions,
    kind,
  };
}

export function formatQuestionTextForStorage(questionText: string, optionsInput?: string[]): string {
  const parsed = parseQuestionPreview(questionText);
  const normalizedOptions = (optionsInput || [])
    .map((item) => compactText(item || ''))
    .filter(Boolean)
    .map((item, idx) => {
      const lineMatch = item.match(OPTION_LINE_RE);
      if (lineMatch) {
        return {
          label: normalizeOptionLabel(lineMatch[1]),
          text: normalizeOptionText(lineMatch[2]),
        };
      }
      const inlineMatch = parseInlineOptions(item);
      if (inlineMatch?.options[0]) return inlineMatch.options[0];
      return {
        label: String.fromCharCode(65 + idx),
        text: normalizeOptionText(item),
      };
    })
    .filter((item, index, arr) => arr.findIndex((target) => target.label === item.label) === index);

  const options = normalizedOptions.length > 0 ? normalizedOptions : parsed.options;
  if (options.length === 0) return parsed.stem;

  return [parsed.stem, ...options.map((item) => `${item.label}. ${item.text}`)].filter(Boolean).join('\n');
}
