import { env } from './env';
import { supabase } from './supabase';

export interface CaptureDraft {
  subject: string;
  questionText: string;
  knowledgePoint: string;
  ability: string;
  errorType: string;
  correctAnswer: string;
  note: string;
  summary: string;
  questionType: 'choice' | 'fill';
  options: string[];
  confidence: number;
  rawContent: string;
  normalizedPayload: Record<string, unknown>;
}

const CAPTURE_AI_ENDPOINT_SUFFIX = '/functions/v1/server/make-server-794e3fa7/chat/stream';

function clampConfidence(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 70;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function normalizeString(value: unknown, fallback: string) {
  const next = String(value || '').trim();
  return next || fallback;
}

function normalizeOptions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6);
}

function parseCaptureDraft(raw: string): CaptureDraft {
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fencedMatch?.[1] || raw).trim();
  const objectMatch = candidate.match(/\{[\s\S]*\}/);
  const jsonText = (objectMatch?.[0] || candidate).trim();
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  const questionType = parsed.questionType === 'choice' || parsed.question_type === 'choice' ? 'choice' : 'fill';
  const options = normalizeOptions(parsed.options);
  return {
    subject: normalizeString(parsed.subject, '英语'),
    questionText: normalizeString(parsed.questionText || parsed.question_text, '请补充题干'),
    knowledgePoint: normalizeString(parsed.knowledgePoint || parsed.knowledge_point, '未标注知识点'),
    ability: normalizeString(parsed.ability, '规则应用'),
    errorType: normalizeString(parsed.errorType || parsed.error_type, '未分类'),
    correctAnswer: normalizeString(parsed.correctAnswer || parsed.correct_answer, ''),
    note: normalizeString(parsed.note, '由OCR识别草稿生成，请确认后提交'),
    summary: normalizeString(parsed.summary, '待复习'),
    questionType: questionType === 'choice' && options.length > 1 ? 'choice' : 'fill',
    options: questionType === 'choice' ? options : [],
    confidence: clampConfidence(parsed.confidence),
    rawContent: raw,
    normalizedPayload: parsed,
  };
}

async function streamCaptureContent(imageBase64: string, mimeType = 'image/jpeg') {
  if (!supabase) {
    throw new Error('Supabase 未配置');
  }
  const baseUrl = String(env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('缺少 EXPO_PUBLIC_SUPABASE_URL');
  }
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new Error(error.message);
  }
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    throw new Error('请先登录');
  }

  const dataUrl = `data:${mimeType};base64,${imageBase64}`;
  const response = await fetch(`${baseUrl}${CAPTURE_AI_ENDPOINT_SUFFIX}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      model: 'qwen3-vl-flash',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '请识别题图并仅返回JSON对象。字段：subject,questionText,knowledgePoint,ability,errorType,correctAnswer,note,summary,questionType(fill/choice),options,confidence(0-100)。不要Markdown，不要解释。',
            },
            {
              type: 'image_url',
              image_url: {
                url: dataUrl,
              },
            },
          ],
        },
      ],
      enable_thinking: false,
      systemPrompt: '你是错题录入助手。必须只输出纯JSON对象。',
    }),
  });
  if (!response.ok || !response.body) {
    const reason = await response.text();
    throw new Error(reason || 'OCR 服务不可用');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
        const chunk = parsed.choices?.[0]?.delta?.content;
        if (chunk) {
          fullContent += chunk;
        }
      } catch {
      }
    }
  }
  return fullContent.trim();
}

export async function extractDraftFromImage(imageBase64: string, mimeType?: string): Promise<CaptureDraft> {
  if (!imageBase64) {
    throw new Error('缺少图片内容');
  }
  const raw = await streamCaptureContent(imageBase64, mimeType);
  if (!raw) {
    throw new Error('OCR 未返回内容');
  }
  try {
    return parseCaptureDraft(raw);
  } catch {
    throw new Error('OCR 结果解析失败，请重试或手动调整');
  }
}
