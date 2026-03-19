import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import * as kv from "./kv_store.tsx";

const app = new Hono();

app.use("*", logger(console.log));
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DOUBAO_API_KEY = Deno.env.get("DOUBAO_API_KEY");
const DOUBAO_MODEL = Deno.env.get("DOUBAO_MODEL") || "doubao-pro-32k";
const DOUBAO_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

// ---- Auth helpers ----
async function getUserId(c: any): Promise<string | null> {
  const auth = c.req.header("Authorization");
  if (!auth) return null;
  const token = auth.split(" ")[1];
  if (!token) return null;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error) {
    console.log("Auth error:", error.message);
    return null;
  }
  return user?.id || null;
}

// ---- Spaced repetition ----
function calculateNextReview(isCorrect: boolean, masteryLevel: number) {
  let newMastery = masteryLevel;
  let daysUntilNext = 1;
  if (isCorrect) {
    newMastery = Math.min(100, masteryLevel + 15);
    if (newMastery >= 85) daysUntilNext = 14;
    else if (newMastery >= 60) daysUntilNext = 7;
    else if (newMastery >= 40) daysUntilNext = 3;
    else daysUntilNext = 1;
  } else {
    newMastery = Math.max(0, masteryLevel - 20);
    daysUntilNext = 1;
  }
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + daysUntilNext);
  const nextReview = nextDate.toISOString().split("T")[0];
  return { newMastery, nextReview };
}

// ---- AI System Prompt ----
const AI_SYSTEM_PROMPT = `你是一个专业的AI错题助手，帮助学生高效整理和分析错题。

当用户分享错题或描述自己哪里做错了，请先给出简短分析，然后在回复末尾生成标准化错题卡片，格式如下（用<CARD>和</CARD>包裹，内容必须是合法JSON）：

<CARD>
{
  "question": "完整题目内容（如有选项请包含）",
  "questionType": "choice（单选题）或 fill（填空题）或 essay（解答题/大题）",
  "options": ["A. 选项1", "B. 选项2", "C. 选项3", "D. 选项4"],
  "correctAnswer": "正确答案（choice类型写单个字母如A；fill写完整答案；essay写核心答案要点）",
  "subject": "科目（数学/英语/物理/化学/生物/历史/地理/政治/编程，必须是这九个之一）",
  "subTopic": "具体考点（如：完型填空、函数与导数、运动学等）",
  "errorTag": "最关键的一个错误原因（知识盲区/粗心大意/概念混淆/计算失误/方法不熟/审题失误/语法时态/公式记错，必须是这八个之一）",
  "difficulty": "简单或中等或困难",
  "analysis": "详细解析和解题思路（150-300字）",
  "knowledge": "涉及的核心知识点（简短列举）"
}
</CARD>

规则：
1. 如果题目信息不完整，先礼貌询问，再生成卡片
2. 生成卡片后主动询问用户是否满意，可以修改后再保存
3. options字段：仅choice类型需要，其他类型设为空数组[]
4. 如果用户只是普通提问而非报告错题，正常回答即可，不生成卡片
5. 始终用中文回复，语气友好专业
6. JSON中不要有注释，确保是合法JSON格式`;

// ============ ROUTES ============

// Health check
app.get("/make-server-794e3fa7/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// ---- Auth ----
app.post("/make-server-794e3fa7/auth/register", async (c) => {
  try {
    const { email, password, name } = await c.req.json();
    if (!email || !password) return c.json({ error: "邮箱和密码不能为空" }, 400);
    if (password.length < 6) return c.json({ error: "密码至少需要6位" }, 400);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { name: name || email.split("@")[0] },
      email_confirm: true,
    });
    if (error) return c.json({ error: error.message }, 400);
    return c.json({ user: data.user }, 201);
  } catch (err) {
    console.log("Register error:", err);
    return c.json({ error: `注册失败: ${err}` }, 500);
  }
});

// ---- Questions ----
app.get("/make-server-794e3fa7/questions", async (c) => {
  try {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: "未登录" }, 401);
    const questions = await kv.getByPrefix(`q:${userId}:`);
    return c.json({ questions: questions || [] });
  } catch (err) {
    console.log("Get questions error:", err);
    return c.json({ error: `获取错题失败: ${err}` }, 500);
  }
});

app.post("/make-server-794e3fa7/questions", async (c) => {
  try {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: "未登录" }, 401);
    const body = await c.req.json();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const question = {
      id,
      userId,
      question: body.question || "",
      questionType: body.questionType || "essay",
      options: body.options || [],
      correctAnswer: body.correctAnswer || "",
      subject: body.subject || "数学",
      subTopic: body.subTopic || "",
      errorTag: body.errorTag || "知识盲区",
      difficulty: body.difficulty || "中等",
      analysis: body.analysis || "",
      knowledge: body.knowledge || "",
      masteryLevel: 0,
      reviewCount: 0,
      lastReview: null,
      nextReview: tomorrow.toISOString().split("T")[0],
      createdAt: now,
      updatedAt: now,
    };
    await kv.set(`q:${userId}:${id}`, question);
    return c.json({ question }, 201);
  } catch (err) {
    console.log("Create question error:", err);
    return c.json({ error: `保存错题失败: ${err}` }, 500);
  }
});

app.put("/make-server-794e3fa7/questions/:id", async (c) => {
  try {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: "未登录" }, 401);
    const id = c.req.param("id");
    const existing = await kv.get(`q:${userId}:${id}`);
    if (!existing) return c.json({ error: "错题不存在" }, 404);
    const body = await c.req.json();
    const updated = { ...existing, ...body, id, userId, updatedAt: new Date().toISOString() };
    await kv.set(`q:${userId}:${id}`, updated);
    return c.json({ question: updated });
  } catch (err) {
    console.log("Update question error:", err);
    return c.json({ error: `更新错题失败: ${err}` }, 500);
  }
});

app.delete("/make-server-794e3fa7/questions/:id", async (c) => {
  try {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: "未登录" }, 401);
    const id = c.req.param("id");
    await kv.del(`q:${userId}:${id}`);
    return c.json({ success: true });
  } catch (err) {
    console.log("Delete question error:", err);
    return c.json({ error: `删除错题失败: ${err}` }, 500);
  }
});

// Review due questions
app.get("/make-server-794e3fa7/questions/review", async (c) => {
  try {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: "未登录" }, 401);
    const today = new Date().toISOString().split("T")[0];
    const allQuestions = await kv.getByPrefix(`q:${userId}:`);
    const due = (allQuestions || []).filter((q: any) => q.nextReview <= today);
    // Shuffle
    due.sort(() => Math.random() - 0.5);
    return c.json({ questions: due, total: due.length });
  } catch (err) {
    console.log("Get review questions error:", err);
    return c.json({ error: `获取复习题目失败: ${err}` }, 500);
  }
});

// Submit review result
app.post("/make-server-794e3fa7/questions/:id/review", async (c) => {
  try {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: "未登录" }, 401);
    const id = c.req.param("id");
    const { isCorrect } = await c.req.json();
    const question = await kv.get(`q:${userId}:${id}`);
    if (!question) return c.json({ error: "错题不存在" }, 404);
    const { newMastery, nextReview } = calculateNextReview(isCorrect, question.masteryLevel || 0);
    const updated = {
      ...question,
      masteryLevel: newMastery,
      nextReview,
      reviewCount: (question.reviewCount || 0) + 1,
      lastReview: new Date().toISOString().split("T")[0],
      updatedAt: new Date().toISOString(),
    };
    await kv.set(`q:${userId}:${id}`, updated);
    return c.json({ question: updated });
  } catch (err) {
    console.log("Review submit error:", err);
    return c.json({ error: `提交复习结果失败: ${err}` }, 500);
  }
});

// Stats
app.get("/make-server-794e3fa7/stats", async (c) => {
  try {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: "未登录" }, 401);
    const today = new Date().toISOString().split("T")[0];
    const allQuestions = await kv.getByPrefix(`q:${userId}:`);
    const questions: any[] = allQuestions || [];
    const total = questions.length;
    const dueToday = questions.filter((q) => q.nextReview <= today).length;
    const avgMastery = total > 0
      ? Math.round(questions.reduce((s, q) => s + (q.masteryLevel || 0), 0) / total)
      : 0;
    const subjectCounts: Record<string, number> = {};
    questions.forEach((q) => {
      subjectCounts[q.subject] = (subjectCounts[q.subject] || 0) + 1;
    });
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const newThisWeek = questions.filter((q) => q.createdAt > weekAgo.toISOString()).length;
    const recent = [...questions]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5);
    return c.json({ total, dueToday, avgMastery, subjectCounts, newThisWeek, recent });
  } catch (err) {
    console.log("Stats error:", err);
    return c.json({ error: `获取统计数据失败: ${err}` }, 500);
  }
});

// ---- AI Chat Stream ----
app.post("/make-server-794e3fa7/chat/stream", async (c) => {
  try {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: "未登录" }, 401);
    if (!DOUBAO_API_KEY) {
      return c.json({ error: "豆包API密钥未配置，请在后台设置 DOUBAO_API_KEY 环境变量" }, 500);
    }
    const { messages } = await c.req.json();
    if (!messages || !Array.isArray(messages)) {
      return c.json({ error: "消息格式错误" }, 400);
    }
    const upstream = await fetch(`${DOUBAO_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DOUBAO_API_KEY}`,
      },
      body: JSON.stringify({
        model: DOUBAO_MODEL,
        messages: [{ role: "system", content: AI_SYSTEM_PROMPT }, ...messages],
        stream: true,
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });
    if (!upstream.ok) {
      const errText = await upstream.text();
      console.log("Doubao API error:", upstream.status, errText);
      return c.json({ error: `豆包API错误 (${upstream.status}): ${errText}` }, 500);
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  } catch (err) {
    console.log("Chat stream error:", err);
    return c.json({ error: `AI聊天失败: ${err}` }, 500);
  }
});

// ---- Export / Import ----
app.get("/make-server-794e3fa7/export", async (c) => {
  try {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: "未登录" }, 401);
    const questions = await kv.getByPrefix(`q:${userId}:`);
    const exportData = {
      version: "1.0",
      appName: "AI错题助手",
      exportedAt: new Date().toISOString(),
      count: (questions || []).length,
      questions: questions || [],
    };
    return new Response(JSON.stringify(exportData, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="wrong-questions.json"',
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    console.log("Export error:", err);
    return c.json({ error: `导出失败: ${err}` }, 500);
  }
});

app.post("/make-server-794e3fa7/import", async (c) => {
  try {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: "未登录" }, 401);
    const { questions, mergeMode } = await c.req.json();
    if (!Array.isArray(questions)) return c.json({ error: "无效的导入格式" }, 400);
    if (mergeMode === "replace") {
      const existing = await kv.getByPrefix(`q:${userId}:`);
      if (existing && existing.length > 0) {
        const keys = existing.map((q: any) => `q:${userId}:${q.id}`);
        await kv.mdel(keys);
      }
    }
    const now = new Date().toISOString();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split("T")[0];
    const imported = questions.map((q: any) => ({
      ...q,
      id: q.id || crypto.randomUUID(),
      userId,
      masteryLevel: q.masteryLevel || 0,
      reviewCount: q.reviewCount || 0,
      lastReview: q.lastReview || null,
      nextReview: q.nextReview || tomorrowStr,
      createdAt: q.createdAt || now,
      updatedAt: now,
    }));
    const keys = imported.map((q: any) => `q:${userId}:${q.id}`);
    await kv.mset(keys, imported);
    return c.json({ imported: imported.length });
  } catch (err) {
    console.log("Import error:", err);
    return c.json({ error: `导入失败: ${err}` }, 500);
  }
});

// ---- Share ----
app.post("/make-server-794e3fa7/share", async (c) => {
  try {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: "未登录" }, 401);
    const { questionIds } = await c.req.json();
    const allQ = await kv.getByPrefix(`q:${userId}:`);
    let toShare: any[] = allQ || [];
    if (Array.isArray(questionIds) && questionIds.length > 0) {
      toShare = toShare.filter((q: any) => questionIds.includes(q.id));
    }
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    const shareData = {
      code,
      createdBy: userId,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      questions: toShare,
    };
    await kv.set(`share:${code}`, shareData);
    return c.json({ shareCode: code, count: toShare.length });
  } catch (err) {
    console.log("Share error:", err);
    return c.json({ error: `分享失败: ${err}` }, 500);
  }
});

app.get("/make-server-794e3fa7/share/:code", async (c) => {
  try {
    const code = c.req.param("code").toUpperCase();
    const shareData = await kv.get(`share:${code}`);
    if (!shareData) return c.json({ error: "分享码不存在或已过期" }, 404);
    if (new Date(shareData.expiresAt) < new Date()) {
      await kv.del(`share:${code}`);
      return c.json({ error: "分享码已过期" }, 404);
    }
    return c.json({
      questions: shareData.questions,
      count: shareData.questions.length,
      createdAt: shareData.createdAt,
    });
  } catch (err) {
    console.log("Get share error:", err);
    return c.json({ error: `获取分享内容失败: ${err}` }, 500);
  }
});

Deno.serve(app.fetch);
