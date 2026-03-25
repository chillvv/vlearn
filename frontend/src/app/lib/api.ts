import { createClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from '../../../utils/supabase/info';
import type { Question, QuestionQuery, Stats, Subject, UserWeakness, VariantQuestion } from './types';
import { ABILITIES, getErrorTypesBySubject, getKnowledgePointsBySubject } from './types';
import { formatQuestionTextForStorage } from './questionPreview';
import {
  buildNormalizedQuestionPayload,
  deriveRenderMode,
  getStemFromPayload,
  normalizeValidationStatus,
  parseStoredNormalizedPayload,
  validateNormalizedQuestionPayload,
} from './questionPayload';

export const supabase = createClient(
  `https://${projectId}.supabase.co`,
  publicAnonKey,
);

function normalizeQuestionRow(row: any): Question {
  const questionText = row?.question_text || row?.question || '未填写题目内容';
  const fallbackPayload = buildNormalizedQuestionPayload({
    questionText,
    optionsInput: Array.isArray(row?.options) ? row.options : [],
    questionTypeHint: row?.question_type,
    correctAnswer: row?.correct_answer,
    explanation: row?.note,
  });
  const normalizedPayload = parseStoredNormalizedPayload(row?.normalized_payload) || fallbackPayload;
  const validation = validateNormalizedQuestionPayload(normalizedPayload);
  const validationStatus = row?.validation_status || normalizeValidationStatus(validation.valid);
  const renderMode = row?.render_mode || deriveRenderMode(validationStatus);
  const normalizedErrorType = normalizeErrorType(row?.subject, row?.error_type, row?.knowledge_point);
  return {
    ...row,
    question_text: questionText,
    question_type: row?.question_type || normalizedPayload.questionType,
    normalized_payload: normalizedPayload,
    validation_status: validationStatus,
    render_mode: renderMode,
    error_type: normalizedErrorType,
    payload_version: row?.payload_version || normalizedPayload.version,
  } as Question;
}

function normalizeQuestionPayload(payload: Partial<Question> & { options?: string[] }) {
  const normalizedPayload = payload.normalized_payload || buildNormalizedQuestionPayload({
    questionText: payload.question_text || '',
    optionsInput: payload.options || [],
    questionTypeHint: payload.question_type,
    correctAnswer: payload.correct_answer,
    explanation: payload.note,
  });
  const validation = validateNormalizedQuestionPayload(normalizedPayload);
  const stem = getStemFromPayload(normalizedPayload);
  const questionText = formatQuestionTextForStorage(
    stem,
    normalizedPayload.questionType === 'choice'
      ? normalizedPayload.options.map((item) => `${item.label}. ${item.text}`)
      : [],
  );
  const validationStatus = normalizeValidationStatus(validation.valid);
  const normalizedErrorType = normalizeErrorType(payload.subject, payload.error_type, payload.knowledge_point);
  return {
    ...payload,
    question_text: questionText,
    question_type: normalizedPayload.questionType,
    raw_ai_response: payload.raw_ai_response || payload.question_text || questionText,
    normalized_payload: normalizedPayload,
    payload_version: normalizedPayload.version,
    validation_status: validationStatus,
    render_mode: deriveRenderMode(validationStatus),
    error_type: normalizedErrorType,
  };
}

function normalizeErrorType(subject?: string, errorType?: string, knowledgePoint?: string) {
  const tags = getErrorTypesBySubject(subject);
  if (errorType && tags.includes(errorType)) return errorType;
  if (knowledgePoint && tags.includes(knowledgePoint)) return knowledgePoint;
  if (subject === '英语') {
    if (knowledgePoint === '主旨理解') return '阅读主旨';
    if (knowledgePoint === '细节理解') return '阅读细节';
    if (knowledgePoint === '推理判断') return '阅读推理';
    if (knowledgePoint === '表达准确') return '写作表达';
  }
  if (subject === 'C语言') {
    if (knowledgePoint === '变量与数据类型') return '数据类型';
    if (knowledgePoint === '运算符与表达式') return '运算表达式';
    if (knowledgePoint === '选择结构' || knowledgePoint === '循环结构') return '分支循环';
    if (knowledgePoint === '函数') return '函数调用';
    if (knowledgePoint === '排序与查找') return '排序查找';
  }
  return tags[0] || errorType || knowledgePoint || '时态';
}

function isMissingColumnError(error: any) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('column') && (msg.includes('does not exist') || msg.includes('not found'));
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
    const normalized = normalizeQuestionPayload(q as Partial<Question> & { options?: string[] });
    const fullInsertPayload = {
      user_id: user.id,
      subject: normalized.subject,
      question_text: normalized.question_text,
      category: normalized.category,
      node: normalized.node,
      image_url: normalized.image_url,
      knowledge_point: normalized.knowledge_point,
      ability: normalized.ability,
      error_type: normalized.error_type,
      question_type: normalized.question_type,
      correct_answer: normalized.correct_answer,
      raw_ai_response: normalized.raw_ai_response,
      normalized_payload: normalized.normalized_payload,
      payload_version: normalized.payload_version,
      validation_status: normalized.validation_status,
      render_mode: normalized.render_mode,
      note: normalized.note,
      summary: normalized.summary,
      confidence: normalized.confidence,
      mastery_level: normalized.mastery_level,
      next_review_date: normalized.next_review_date,
      stubborn_flag: normalized.stubborn_flag,
      review_count: normalized.review_count || 0,
    };
    const legacyInsertPayload = {
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
    };
    let insertResult = await supabase.from('questions').insert(fullInsertPayload).select().single();
    if (insertResult.error && isMissingColumnError(insertResult.error)) {
      insertResult = await supabase.from('questions').insert(legacyInsertPayload).select().single();
    }
    if (insertResult.error) throw new Error(insertResult.error.message);
    
    if (q.knowledge_point && q.ability) {
      await weaknessApi.incrementError(q.knowledge_point, q.ability);
    }
    
    return normalizeQuestionRow(insertResult.data);
  },

  update: async (id: string, updates: Partial<Question>): Promise<Question> => {
    const normalized = (updates.question_text !== undefined || updates.correct_answer !== undefined || updates.question_type !== undefined)
      ? normalizeQuestionPayload(updates as Partial<Question> & { options?: string[] })
      : updates;
    let updateResult = await supabase
      .from('questions')
      .update(normalized)
      .eq('id', id)
      .select()
      .single();
    if (updateResult.error && isMissingColumnError(updateResult.error)) {
      const legacyUpdates = { ...updates };
      delete (legacyUpdates as any).question_type;
      delete (legacyUpdates as any).correct_answer;
      delete (legacyUpdates as any).raw_ai_response;
      delete (legacyUpdates as any).normalized_payload;
      delete (legacyUpdates as any).payload_version;
      delete (legacyUpdates as any).validation_status;
      delete (legacyUpdates as any).render_mode;
      delete (legacyUpdates as any).mastery_level;
      delete (legacyUpdates as any).confidence;
      delete (legacyUpdates as any).next_review_date;
      delete (legacyUpdates as any).stubborn_flag;
      delete (legacyUpdates as any).review_count;
      updateResult = await supabase
        .from('questions')
        .update(legacyUpdates)
        .eq('id', id)
        .select()
        .single();
    }
    if (updateResult.error) throw new Error(updateResult.error.message);
    return normalizeQuestionRow(updateResult.data);
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
    const prompt = `请作为专业教师，针对${subject}学科生成 ${amount} 道变式训练题。
    ${nodes.length > 0 ? `考察的知识点为：${nodes.join('、')}。` : ''}
    出题策略要求为：【${strategy}】（如果为“递进”，题目难度从易到难；如果为“随机”，难度随机；如果为“攻坚”，均为高难度题）。
    
    要求：
    1. 题目必须完整，如果是阅读理解完形填空等，必须包含完整的文章或上下文。
    2. 返回格式必须是纯 JSON 数组，不要有任何额外的 Markdown 标记（不要包含 \`\`\`json 等）。
    
    JSON 格式如下：
    [
      {
        "level": 1, // 难度层级 1-5
        "question_type": "choice", // 必须是 "choice" (选择题) 或 "fill" (填空/解答题)
        "question_text": "完整的题目内容（包含所需的文章、题干）",
        "options": ["A. 选项1", "B. 选项2", "C. 选项3", "D. 选项4"], // 仅选择题需要，必须带字母前缀
        "correct_answer": "A", // 单选填字母，填空解答填具体答案
        "explanation": "详细的解题步骤和解析"
      }
    ]
    `;

    let fullContent = '';
    await new Promise<void>((resolve, reject) => {
      chatApi.streamChat(
        [{ role: 'user', content: prompt }],
        () => {},
        (content) => {
          fullContent = content;
          resolve();
        },
        (err) => reject(new Error(err)),
        {
          systemPrompt: '你是一个专业的出题AI。你必须严格按照用户要求的JSON格式输出，不包含任何额外说明。'
        }
      );
    });

    try {
      const jsonMatch = fullContent.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('生成格式错误');
      const parsed = JSON.parse(jsonMatch[0]);
      
      const variants: VariantQuestion[] = parsed.map((item: any, idx: number) => {
        return {
          level: item.level || (idx + 1),
          question_type: item.question_type === 'choice' ? 'choice' : 'fill',
          question_text: item.question_text || '题目加载失败',
          options: Array.isArray(item.options) ? item.options : [],
          correct_answer: item.correct_answer || '',
          acceptable_answers: [],
          explanation: item.explanation || '暂无解析'
        };
      });
      return { variants };
    } catch (e) {
      console.error('Failed to parse AI response:', fullContent);
      throw new Error('AI 生成题目解析失败，请重试');
    }
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
    
    // 待复习：基于艾宾浩斯，next_review_date < now
    const now = new Date();
    const dueReviewCount = questions.filter(q => !q.next_review_date || new Date(q.next_review_date) <= now).length;

    const topWeakness = weaknesses.length > 0 ? weaknesses[0] : null;
    const weaknessesList = weaknesses.slice(0, 4); // Top 4
    
    const subjectCounts: Record<string, number> = {};
    const subjectMasterySum: Record<string, number> = {};
    const errorTypeCounts: Record<string, number> = {};
    
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 6);
    weekAgo.setHours(0,0,0,0);
    const newThisWeek = questions.filter((q) => new Date(q.created_at) > weekAgo).length;

    // Activity array for the last 7 days [day-6, day-5, ... today]
    const weeklyActivity = [0, 0, 0, 0, 0, 0, 0];

    questions.forEach((q) => {
      // Subject counts & mastery
      const subj = q.subject || '未知';
      subjectCounts[subj] = (subjectCounts[subj] || 0) + 1;
      
      const mastery = q.mastery_level ?? Math.round((q.confidence ?? 0.5) * 100);
      subjectMasterySum[subj] = (subjectMasterySum[subj] || 0) + mastery;

      // Error types
      const errType = q.error_type || '未分类';
      errorTypeCounts[errType] = (errorTypeCounts[errType] || 0) + 1;

      // Weekly activity based on created_at
      const createdAt = new Date(q.created_at);
      if (createdAt >= weekAgo) {
        // Find which day bucket it belongs to (0 to 6)
        const diffTime = createdAt.getTime() - weekAgo.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays >= 0 && diffDays <= 6) {
          weeklyActivity[diffDays]++;
        }
      }
    });

    const subjectMastery = Object.keys(subjectCounts).map(subj => ({
      subject: subj,
      count: subjectCounts[subj],
      score: Math.round(subjectMasterySum[subj] / subjectCounts[subj])
    }));

    // Sort error types and calculate percentages
    const totalErrors = Object.values(errorTypeCounts).reduce((a, b) => a + b, 0);
    const errorTypes = Object.entries(errorTypeCounts)
      .map(([name, count]) => ({
        name,
        value: totalErrors > 0 ? Math.round((count / totalErrors) * 100) : 0,
        count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3); // Top 3 error types
    
    const recent = [...questions].slice(0, 5);
    
    return { 
      total, 
      weaknessCount, 
      dueReviewCount,
      topWeakness, 
      subjectCounts, 
      newThisWeek, 
      recent,
      subjectMastery,
      weeklyActivity,
      errorTypes,
      weaknessesList
    };
  },
};

type CopilotLearningProfileOptions = {
  maxSamples?: number;
};

function buildTopListText(counter: Record<string, number>, maxItems = 5) {
  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxItems)
    .map(([name, count]) => `${name}(${count})`)
    .join('、');
}

export async function buildCopilotLearningProfile(
  options: CopilotLearningProfileOptions = {},
): Promise<string> {
  const maxSamples = options.maxSamples && options.maxSamples > 0 ? options.maxSamples : 8;
  try {
    const [questions, weaknesses] = await Promise.all([
      questionsApi.getAll({ sortBy: 'latestWrong' }),
      weaknessApi.getAll(),
    ]);
    const total = questions.length;
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const dueCount = questions.filter((item) => !item.next_review_date || new Date(item.next_review_date).getTime() <= now).length;
    const lowMasteryCount = questions.filter((item) => (item.mastery_level ?? Math.round((item.confidence ?? 0.5) * 100)) < 80).length;
    const createdThisWeek = questions.filter((item) => now - new Date(item.created_at).getTime() <= weekMs).length;
    const subjectCounter: Record<string, number> = {};
    const pointCounter: Record<string, number> = {};
    const errorCounter: Record<string, number> = {};
    questions.forEach((item) => {
      const subject = item.subject || '未知科目';
      const point = item.knowledge_point || '未标注知识点';
      const errorType = item.error_type || '未标注错因';
      subjectCounter[subject] = (subjectCounter[subject] || 0) + 1;
      pointCounter[point] = (pointCounter[point] || 0) + 1;
      errorCounter[errorType] = (errorCounter[errorType] || 0) + 1;
    });
    const weaknessText = weaknesses
      .slice(0, 5)
      .map((item) => `${item.knowledge_point}/${item.ability}(${item.error_count})`)
      .join('、');
    const sampleText = questions
      .slice(0, maxSamples)
      .map((item, index) => {
        const stem = (item.question_text || '').replace(/\s+/g, ' ').slice(0, 36);
        const mastery = item.mastery_level ?? Math.round((item.confidence ?? 0.5) * 100);
        return `${index + 1}. [${item.subject}] ${item.knowledge_point}/${item.error_type} 掌握度${mastery} 题干:${stem}`;
      })
      .join('\n');
    return `学习档案快照（系统提供，可信）：
- 错题总数：${total}
- 待复习题数：${dueCount}
- 低掌握度题数（<80）：${lowMasteryCount}
- 近7天新增：${createdThisWeek}
- 科目分布：${buildTopListText(subjectCounter, 6) || '暂无'}
- 高频知识点：${buildTopListText(pointCounter, 6) || '暂无'}
- 高频错因：${buildTopListText(errorCounter, 6) || '暂无'}
- user_weakness高频：${weaknessText || '暂无'}
- 最近错题样本：
${sampleText || '暂无'}
请严格基于这份学习档案回答用户“弱点/错题分布/复习优先级”等问题；如果总数为0，再明确说明暂无错题数据。`;
  } catch (error) {
    return `学习档案快照获取失败：${String(error)}。请先提示用户当前无法读取错题库，然后给出排查建议。`;
  }
}

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
- 英语: ${getKnowledgePointsBySubject('英语').join(", ")}
- C语言: ${getKnowledgePointsBySubject('C语言').join(", ")}

能力维度：
${ABILITIES.join(", ")}

错误原因：
- 英语: ${getErrorTypesBySubject('英语').join(", ")}
- C语言: ${getErrorTypesBySubject('C语言').join(", ")}

规则：
1. 不允许用户选分类，AI强制结构化
2. 只能从给定列表中选择，不允许新增分类，不允许使用“粗心/审题不清/不熟练”等泛化标签
3. 始终用中文回复，语气友好专业
4. JSON中不要有注释，确保是合法JSON格式`;

const AI_COPILOT_PROMPT = `你是“全能AI学伴”，只能处理学习相关请求：错题解答、错题入库、复习建议、练习建议。

输出规则：
1. 先输出给用户看的中文讲解。
2. 如果需要执行动作，必须在末尾输出 <ACTION>...</ACTION>，其中是合法JSON，且只包含以下type：
   - create_mistake
   - update_tags
   - start_review
   - start_drill
   - delete_mistake
   - update_learning_content
3. 默认策略是“先建议再执行”，所以动作只产出建议，不表示已执行。
4. 高风险动作（删除、批量覆盖）risk 必须为 "high"。
5. 仅学习域；若用户闲聊或越界，礼貌拒绝并引导到复习或练习动作。
6. 当用户要求改写“提分锦囊”或“知识点抽屉”内容时，使用 update_learning_content，并在 payload 中给出 node/tag、tips、summary、tables。
7. 你会收到“学习档案快照（系统提供，可信）”，必须优先依据该快照回答“我有哪些弱点/错题在哪些板块”。
8. 只有当快照里“错题总数=0”时，才能说“暂无错题”；否则必须给出分布、Top弱点、优先复习建议。

ACTION JSON格式：
<ACTION>
{
  "type": "create_mistake",
  "risk": "low",
  "title": "发现新错题📝",
  "description": "请确认后执行",
  "payload": {}
}
</ACTION>`;

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function stripImportedQuestion(raw: any) {
  if (!raw || typeof raw !== 'object') return {};
  const next = { ...raw };
  delete next.id;
  delete next.user_id;
  delete next.created_at;
  delete next.updated_at;
  return next;
}

function generateShareCode() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// ---- Sync API ----
export const syncApi = {
  export: async () => {
    const questions = await questionsApi.getAll();
    const exportData = {
      version: '1.0',
      appName: 'AI错题助手',
      exportedAt: new Date().toISOString(),
      count: questions.length,
      questions,
    };
    downloadJson(`wrong-questions-${new Date().toISOString().slice(0, 10)}.json`, exportData);
  },
  import: async (file: File, mode: 'merge' | 'replace') => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    const text = await file.text();
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('文件不是合法 JSON');
    }
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.questions) ? parsed.questions : []);
    if (!Array.isArray(list)) throw new Error('导入格式不正确');

    if (mode === 'replace') {
      const { error } = await supabase.from('questions').delete().eq('user_id', user.id);
      if (error) throw new Error(error.message);
    }

    let imported = 0;
    for (const item of list) {
      try {
        await questionsApi.create(stripImportedQuestion(item));
        imported++;
      } catch {
        // skip
      }
    }
    return { imported };
  },
  createShareCode: async () => {
    const all = await questionsApi.getAll();
    const payloadQuestions = all.map((q) => stripImportedQuestion(q));

    const rpc = await supabase.rpc('create_share_code', { p_question_ids: null });
    if (!rpc.error && rpc.data) {
      return { shareCode: String(rpc.data), count: payloadQuestions.length };
    }

    const code = generateShareCode();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('未登录');
    const insert = await supabase.from('shared_questions').insert({
      code,
      user_id: user.id,
      questions: payloadQuestions,
      expires_at: expiresAt,
    }).select('code').single();
    if (insert.error) throw new Error(insert.error.message);
    return { shareCode: insert.data.code, count: payloadQuestions.length };
  },
  importByCode: async (code: string) => {
    const normalizedCode = code.trim().toUpperCase();

    const rpc = await supabase.rpc('get_shared_questions', { p_code: normalizedCode });
    if (!rpc.error && rpc.data) {
      return { questions: Array.isArray(rpc.data) ? rpc.data : [] };
    }

    const { data, error } = await supabase
      .from('shared_questions')
      .select('questions, expires_at')
      .eq('code', normalizedCode)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('分享码不存在或已过期');
    if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
      throw new Error('分享码已过期');
    }
    return { questions: Array.isArray(data.questions) ? data.questions : [] };
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
      systemPrompt?: string;
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
          messages: [{ role: "system", content: options?.systemPrompt || AI_SYSTEM_PROMPT }, ...messages],
          stream: true,
          temperature: 0.7,
          max_tokens: 3000,
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
  streamCopilot: async (
    messages: { role: string; content: string }[],
    onChunk: (chunk: string, isReasoning?: boolean) => void,
    onComplete: (fullContent: string) => void,
    onError: (error: string) => void,
    options?: { injectLearningProfile?: boolean; enableThinking?: boolean; onReasoningChunk?: (chunk: string) => void }
  ) => {
    let finalSystemPrompt = AI_COPILOT_PROMPT;
    if (options?.injectLearningProfile !== false) {
      const profile = await buildCopilotLearningProfile();
      finalSystemPrompt = `${AI_COPILOT_PROMPT}\n\n${profile}`;
    }
    return chatApi.streamChat(
      messages,
      (chunk) => onChunk(chunk, false),
      onComplete,
      onError,
      {
        enableThinking: options?.enableThinking ?? false,
        onReasoningChunk: (chunk) => {
          if (options?.onReasoningChunk) options.onReasoningChunk(chunk);
          onChunk(chunk, true);
        },
        systemPrompt: finalSystemPrompt,
      }
    );
  },
};
