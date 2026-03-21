import { createClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import type { Question, QuestionQuery, Stats, Subject, UserWeakness, VariantQuestion } from './types';
import { ENGLISH_KNOWLEDGE_POINTS, PROGRAMMING_KNOWLEDGE_POINTS, ABILITIES, ERROR_TYPES } from './types';
import { formatQuestionTextForStorage } from './questionPreview';

export const supabase = createClient(
  `https://${projectId}.supabase.co`,
  publicAnonKey,
);

function normalizeQuestionRow(row: any): Question {
  return {
    ...row,
    question_text: row?.question_text || row?.question || '未填写题目内容',
  } as Question;
}

function normalizeQuestionPayload(payload: Partial<Question>) {
  const questionText = formatQuestionTextForStorage(payload.question_text || '');
  return {
    ...payload,
    question_text: questionText,
  };
}

// ---- Auth ----
export const authApi = {
  register: async (email: string, password: string, name: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name }
      }
    });
    if (error) throw new Error(error.message);
    return data;
  },
  login: async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return data;
  },
  logout: async () => {
    await supabase.auth.signOut();
  },
};

// ---- Weakness Stats ----
export const weaknessApi = {
  getAll: async (): Promise<UserWeakness[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');

    const { data, error } = await supabase
      .from('user_weakness')
      .select('*')
      .eq('user_id', user.id)
      .order('error_count', { ascending: false });

    if (error) throw new Error(error.message);
    return data as UserWeakness[];
  },
  
  incrementError: async (knowledgePoint: string, ability: string): Promise<void> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');

    const { data: existing } = await supabase
      .from('user_weakness')
      .select('*')
      .eq('user_id', user.id)
      .eq('knowledge_point', knowledgePoint)
      .eq('ability', ability)
      .single();
      
    if (existing) {
      await supabase
        .from('user_weakness')
        .update({ 
          error_count: existing.error_count + 1,
          last_updated: new Date().toISOString()
        })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('user_weakness')
        .insert({
          user_id: user.id,
          knowledge_point: knowledgePoint,
          ability: ability,
          error_count: 1
        });
    }
  }
};

// ---- Questions ----
export const questionsApi = {
  getAll: async (query: QuestionQuery = {}): Promise<Question[]> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');

    const { data, error } = await supabase
      .from('questions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    let result = (data || []).map(normalizeQuestionRow);
    const now = new Date();
    if (query.subject) result = result.filter(item => item.subject === query.subject);
    if (query.category) result = result.filter(item => (item.category || '未分类') === query.category);
    if (query.l2) result = result.filter(item => (item.ability || item.error_type || '核心考点') === query.l2);
    if (query.nodes && query.nodes.length > 0) {
      result = result.filter(item => query.nodes?.includes(item.node || item.knowledge_point));
    }
    if (query.onlyDue) {
      result = result.filter(item => !item.next_review_date || new Date(item.next_review_date) <= now);
    }
    if (query.onlyUnmastered) {
      result = result.filter(item => (item.mastery_level ?? Math.round((item.confidence ?? 0.5) * 100)) < 80);
    }
    if (query.onlyStubborn) {
      result = result.filter(item => Boolean(item.stubborn_flag));
    }
    if (query.sortBy === 'latestWrong') {
      result = result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } else if (query.sortBy === 'lowestMastery') {
      result = result.sort((a, b) => (a.mastery_level ?? 0) - (b.mastery_level ?? 0));
    } else if (query.sortBy === 'nearestDue') {
      result = result.sort((a, b) => new Date(a.next_review_date || 0).getTime() - new Date(b.next_review_date || 0).getTime());
    }
    if (query.limit && query.limit > 0) {
      result = result.slice(0, query.limit);
    }
    return result;
  },

  create: async (q: Partial<Question>): Promise<Question> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    const normalized = normalizeQuestionPayload(q);

    const { data, error } = await supabase
      .from('questions')
      .insert({
        user_id: user.id,
        subject: normalized.subject,
        question_text: normalized.question_text,
        category: normalized.category,
        node: normalized.node,
        image_url: normalized.image_url,
        knowledge_point: normalized.knowledge_point,
        ability: normalized.ability,
        error_type: normalized.error_type,
        note: normalized.note,
        summary: normalized.summary,
        confidence: normalized.confidence,
        mastery_level: normalized.mastery_level,
        next_review_date: normalized.next_review_date,
        stubborn_flag: normalized.stubborn_flag,
        review_count: normalized.review_count || 0,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    
    if (q.knowledge_point && q.ability) {
      await weaknessApi.incrementError(q.knowledge_point, q.ability);
    }
    
    return normalizeQuestionRow(data);
  },

  update: async (id: string, updates: Partial<Question>): Promise<Question> => {
    const normalized = updates.question_text !== undefined
      ? normalizeQuestionPayload(updates)
      : updates;
    const { data, error } = await supabase
      .from('questions')
      .update(normalized)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return normalizeQuestionRow(data);
  },

  delete: async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('questions')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  },

  add: async (q: Partial<Question>): Promise<Question> => {
    return questionsApi.create(q);
  },

  generateVariants: async (
    subject: Subject,
    nodes: string[],
    amount: number,
    strategy: '递进' | '随机' | '攻坚',
  ): Promise<{ variants: VariantQuestion[] }> => {
    const scoped = await questionsApi.getAll({ subject, nodes, sortBy: strategy === '递进' ? 'lowestMastery' : 'latestWrong' });
    const seed = scoped.length > 0 ? scoped : await questionsApi.getAll({ subject, sortBy: 'latestWrong' });
    const variants: VariantQuestion[] = seed.slice(0, amount).map((item, idx) => ({
      level: strategy === '递进' ? idx + 1 : Math.floor(Math.random() * 5) + 1,
      question_text: item.question_text,
      options: ['A. 选项一', 'B. 选项二', 'C. 选项三', 'D. 选项四'],
      correct_answer: 'A',
      explanation: item.note || '请复盘知识点与步骤顺序。',
    }));
    return { variants };
  },

  swipeReview: async (id: string, action: 'again' | 'easy'): Promise<Question> => {
    const current = await supabase
      .from('questions')
      .select('*')
      .eq('id', id)
      .single();
    if (current.error || !current.data) throw new Error(current.error?.message || '题目不存在');
    const confidence = action === 'again'
      ? Math.max(0, (current.data.confidence || 0.5) - 0.15)
      : Math.min(1, (current.data.confidence || 0.5) + 0.12);
    const mastery_level = Math.round(confidence * 100);
    const days = action === 'again' ? 1 : 4;
    const next_review_date = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    return questionsApi.update(id, {
      confidence,
      mastery_level,
      next_review_date,
      review_count: (current.data.review_count || 0) + 1,
    });
  },
};

// ---- Stats ----
export const statsApi = {
  get: async (): Promise<Stats> => {
    const questions = await questionsApi.getAll();
    const weaknesses = await weaknessApi.getAll();
    
    const total = questions.length;
    const weaknessCount = weaknesses.length;
    const topWeakness = weaknesses.length > 0 ? weaknesses[0] : null;
    
    const subjectCounts: Record<string, number> = {};
    questions.forEach((q) => {
      subjectCounts[q.subject] = (subjectCounts[q.subject] || 0) + 1;
    });
    
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const newThisWeek = questions.filter((q) => q.created_at > weekAgo.toISOString()).length;
    
    const recent = [...questions].slice(0, 5);
    
    return { total, weaknessCount, topWeakness, subjectCounts, newThisWeek, recent };
  },
};

// ---- AI System Prompt ----
const AI_SYSTEM_PROMPT = `你是一个学习分类系统，负责分析用户的错题。

用户会提供题目（可能附带文字）和错误描述（"我哪里错了"）。
请分析错题，并生成标准化错题卡片，格式如下（用<CARD>和</CARD>包裹，内容必须是合法JSON）：

<CARD>
{
  "subject": "英语 或 C语言",
  "question_text": "完整题目内容",
  "knowledge_point": "必须从对应的知识点列表中选择最合适的一个",
  "ability": "必须从能力维度列表中选择一个",
  "error_type": "必须从错误原因列表中选择一个",
  "note": "非结构化补充说明，比如你的分析建议"
}
</CARD>

知识点列表：
- 英语: ${ENGLISH_KNOWLEDGE_POINTS.join(", ")}
- C语言: ${PROGRAMMING_KNOWLEDGE_POINTS.join(", ")}

能力维度：
${ABILITIES.join(", ")}

错误原因：
${ERROR_TYPES.join(", ")}

规则：
1. 不允许用户选分类，AI强制结构化
2. 只能从给定列表中选择，不允许新增分类
3. 始终用中文回复，语气友好专业
4. JSON中不要有注释，确保是合法JSON格式`;

// ---- Sync API (Dummy for now) ----
export const syncApi = {
  export: async () => {
    // Dummy export
  },
  import: async (file: File, mode: 'merge' | 'replace') => {
    return { imported: 0 };
  },
  createShareCode: async () => {
    return { shareCode: 'ABCD1234', count: 0 };
  },
  importByCode: async (code: string) => {
    return { questions: [] };
  }
};

// ---- Chat (streaming) ----
export const chatApi = {
  streamChat: async (
    messages: { role: string; content: string }[],
    onChunk: (chunk: string) => void,
    onComplete: (fullContent: string) => void,
    onError: (error: string) => void,
    options?: {
      enableThinking?: boolean;
      onReasoningChunk?: (chunk: string) => void;
    },
  ) => {
    const env = (import.meta as any).env || {};
    const DASHSCOPE_API_KEY = env.VITE_DASHSCOPE_API_KEY || env.NEXT_PUBLIC_DASHSCOPE_API_KEY;
    const QWEN_MODEL = env.VITE_QWEN_MODEL || env.NEXT_PUBLIC_QWEN_MODEL || "qwen3.5-flash";
    const QWEN_BASE_URL = env.VITE_QWEN_BASE_URL || env.NEXT_PUBLIC_QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";

    try {
      if (!DASHSCOPE_API_KEY) {
        onError("未配置 VITE_DASHSCOPE_API_KEY，无法调用 qwen3.5-flash");
        return;
      }
      const response = await fetch(`${QWEN_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${DASHSCOPE_API_KEY}`,
        },
        body: JSON.stringify({
          model: QWEN_MODEL,
          messages: [{ role: "system", content: AI_SYSTEM_PROMPT }, ...messages],
          stream: true,
          temperature: 0.7,
          enable_thinking: options?.enableThinking ?? false,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        onError(`AI请求失败: ${errText}`);
        return;
      }

      const reader = response.body!.getReader();
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
          if (line.startsWith('data: ')) {
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') {
              onComplete(fullContent);
              return;
            }
            try {
              const parsed = JSON.parse(raw);
              const reasoningContent = parsed.choices?.[0]?.delta?.reasoning_content;
              if (reasoningContent && options?.onReasoningChunk) {
                options.onReasoningChunk(reasoningContent);
              }
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullContent += content;
                onChunk(content);
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      }
      onComplete(fullContent);
    } catch (err) {
      onError(`网络请求失败: ${err}`);
    }
  },
};
