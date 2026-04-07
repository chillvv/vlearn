import http from 'node:http';
import { URL } from 'node:url';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';

const port = Number(process.env.PORT || 8080);
const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const corsOrigin = String(process.env.CORS_ORIGIN || '*').trim();
const reviewAiPlannerEnabled = /^(true|1|yes|on)$/i.test(String(process.env.REVIEW_AI_PLANNER_ENABLED || 'false').trim());
const reviewAiFallbackEnabled = !/^(false|0|no|off)$/i.test(String(process.env.REVIEW_AI_FALLBACK_ENABLED || 'true').trim());
const reviewAiProxyUrl = String(process.env.REVIEW_AI_PROXY_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions').trim();
const reviewAiModel = String(process.env.REVIEW_AI_MODEL || 'qwen3.5-plus').trim();
const reviewAiApiKey = String(process.env.REVIEW_AI_API_KEY || process.env.DASHSCOPE_API_KEY || '').trim();
const REVIEW_PLANNER_TIMEOUT_MS = 5000;
const supabaseUrl = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://kepmdwisavomgrksvgff.supabase.co').trim();
const supabaseAnonKey = String(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtlcG1kd2lzYXZvbWdya3N2Z2ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NTc1NDUsImV4cCI6MjA4OTMzMzU0NX0.Q0xU709C6boLIvDE_fWNex8477edSF-ehpicLQY0xiM').trim();
const localDevFallbackAccessToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJsb2NhbC1kZXYtdXNlciIsImVtYWlsIjoibG9jYWxAZXhhbXBsZS5jb20iLCJleHAiOjQxMDI0NDQ4MDB9.local';

if (!databaseUrl) {
  throw new Error('缺少 DATABASE_URL');
}

const pool = new Pool({ connectionString: databaseUrl });

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function normalizeStrategyMeta(raw) {
  const strategyTemplate = String(raw?.strategy_template || raw?.strategyTemplate || 'daily-reinforce').trim() || 'daily-reinforce';
  const strategyLabel = String(raw?.strategy_label || raw?.strategyLabel || '日常巩固').trim() || '日常巩固';
  const promptHint = String(raw?.prompt_hint || raw?.promptHint || '').trim();
  const planVersion = String(raw?.plan_version || raw?.planVersion || `review-ai-live-v2-${strategyTemplate}`).trim() || `review-ai-live-v2-${strategyTemplate}`;
  const weightingSource = raw?.weighting_profile || raw?.weightingProfile || {};
  return {
    strategy_template: strategyTemplate,
    strategy_label: strategyLabel,
    prompt_hint: promptHint,
    plan_version: planVersion,
    weighting_profile: {
      due: clampNumber(weightingSource?.due, 24, 0, 100),
      recall: clampNumber(weightingSource?.recall, 28, 0, 100),
      lapse: clampNumber(weightingSource?.lapse, 12, 0, 100),
      stability: clampNumber(weightingSource?.stability, 16, 0, 100),
      difficulty: clampNumber(weightingSource?.difficulty, 10, 0, 100),
      new_question: clampNumber(weightingSource?.new_question, 6, 0, 100),
    },
  };
}

function normalizeRolloutMetadata(raw, payload) {
  return {
    planner_enabled: Boolean(raw?.planner_enabled),
    gray_percent: clampNumber(raw?.gray_percent, 0, 0, 100),
    gray_bucket: clampNumber(raw?.gray_bucket, 0, 0, 99),
    selected: Boolean(raw?.selected),
    page_number: Math.max(1, Math.round(Number(raw?.page_number || 0) || Number(payload?.page_number || 0) || 1)),
  };
}

function buildPlannerPrompt(payload, template) {
  return `你是复习计划 AI Planner。请只基于给定候选集重排题目，不得输出候选集之外的 question_id。

策略模板：${template.strategy_template}
策略标签：${template.strategy_label}
策略说明：${template.prompt_hint}
权重画像：${JSON.stringify(template.weighting_profile)}

请输出严格 JSON，不要输出 markdown，不要输出解释文字。
输出格式：
{
  "request_id": "${payload.request_id}",
  "plan_version": "${template.plan_version}",
  "queue": [
    {
      "question_id": "候选集中的ID",
      "rank": 1,
      "reason": "一句中文原因",
      "suggested_interval_days": 1,
      "priority_score": 0-100数字,
      "strategy": "rescue|reinforce|new|revisit"
    }
  ],
  "mix": {
    "rescue": 0-1数字,
    "reinforce": 0-1数字,
    "new": 0-1数字,
    "revisit": 0-1数字
  },
  "risk": {
    "high_volatility": true,
    "high_fatigue": false,
    "missing_data": false,
    "notes": ["中文风险说明"]
  },
  "confidence": 0-1数字
}

约束：
1. queue 最多 ${payload.session_constraints?.budget_count || 20} 题。
2. 题目必须来自候选集 questions。
3. 优先满足 due 覆盖与高遗忘风险。
4. reason 必须简洁可解释。

输入：
${JSON.stringify(payload)}`;
}

function extractPlannerJson(content) {
  const plain = String(content || '').replace(/```json|```/gi, '').trim();
  const match = plain.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('planner_json_missing');
  }
  return JSON.parse(match[0]);
}

function inferPlannerStrategy(question, priorityScore) {
  if (question?.is_due) return 'rescue';
  if ((question?.review_count || 0) === 0) return 'new';
  if ((question?.lapse_count || 0) >= 2 || Number(question?.predicted_recall || 0) < 0.35 || priorityScore >= 80) return 'revisit';
  return 'reinforce';
}

function generateHeuristicPlannerOutput(payload, strategyMeta) {
  const questions = Array.isArray(payload?.questions) ? payload.questions : [];
  const weightingProfile = strategyMeta.weighting_profile;
  const ranked = questions
    .map((question) => {
      const urgencyScore = (question.is_due ? weightingProfile.due : 0)
        + (1 - clampNumber(question.predicted_recall, 0.5, 0, 1)) * weightingProfile.recall
        + clampNumber(question.lapse_count, 0, 0, 10) * weightingProfile.lapse
        + (1 - clampNumber(question.stability, 0.5, 0, 1)) * weightingProfile.stability
        + clampNumber(question.difficulty, 0.5, 0, 1) * weightingProfile.difficulty
        + ((question.review_count || 0) === 0 ? weightingProfile.new_question : 0);
      const priorityScore = Math.round(Math.min(100, urgencyScore));
      const strategy = inferPlannerStrategy(question, priorityScore);
      const reason = question.is_due
        ? '到期题优先抢救，避免遗忘继续扩大'
        : strategy === 'revisit'
          ? '近期波动较大，建议优先回访巩固'
          : strategy === 'new'
            ? '新题首次进入计划，安排轻量试探'
            : '当前适合继续巩固，保持节奏';
      return {
        question,
        priorityScore,
        strategy,
        reason,
      };
    })
    .sort((left, right) => {
      if (right.priorityScore !== left.priorityScore) return right.priorityScore - left.priorityScore;
      return String(left.question?.question_id || '').localeCompare(String(right.question?.question_id || ''), 'zh-CN');
    })
    .slice(0, Math.max(1, Number(payload?.session_constraints?.budget_count || 20)));

  const total = ranked.length || 1;
  const mixCounter = {
    rescue: 0,
    reinforce: 0,
    new: 0,
    revisit: 0,
  };
  const queue = ranked.map((item, index) => {
    mixCounter[item.strategy] += 1;
    return {
      question_id: item.question.question_id,
      rank: index + 1,
      reason: item.reason,
      suggested_interval_days: item.question.is_due ? 1 : Math.max(1, Math.round((1 - Number(item.question.predicted_recall || 0)) * 4)),
      priority_score: item.priorityScore,
      strategy: item.strategy,
    };
  });
  return {
    request_id: payload.request_id,
    plan_version: strategyMeta.plan_version,
    queue,
    mix: {
      rescue: Number((mixCounter.rescue / total).toFixed(3)),
      reinforce: Number((mixCounter.reinforce / total).toFixed(3)),
      new: Number((mixCounter.new / total).toFixed(3)),
      revisit: Number((mixCounter.revisit / total).toFixed(3)),
    },
    risk: {
      high_volatility: ranked.some((item) => Number(item.question?.lapse_count || 0) >= 2),
      high_fatigue: ranked.filter((item) => Number(item.question?.difficulty || 0) >= 0.75).length >= Math.max(3, Math.floor(total * 0.6)),
      missing_data: questions.some((item) => Number(item.predicted_recall || 0) === 0 && Number(item.stability || 0) === 0),
      notes: ['未配置外部模型时使用本地启发式重排'],
    },
    confidence: 0.68,
  };
}

function normalizePlannerOutput(raw, payload, planVersion) {
  const queue = Array.isArray(raw?.queue) ? raw.queue : [];
  if (!queue.length) {
    throw new Error('planner_queue_empty');
  }
  return {
    request_id: String(raw?.request_id || payload?.request_id || '').trim() || payload.request_id,
    plan_version: String(raw?.plan_version || '').trim() || planVersion,
    queue: queue.map((item, index) => ({
      question_id: String(item?.question_id || '').trim(),
      rank: Math.max(1, Math.round(clampNumber(item?.rank, index + 1, 1, 999))),
      reason: String(item?.reason || '').trim() || 'AI 未提供理由，已按候选特征兜底',
      suggested_interval_days: Math.max(1, Math.round(clampNumber(item?.suggested_interval_days, 1, 1, 365))),
      priority_score: clampNumber(item?.priority_score, 50, 0, 100),
      strategy: ['rescue', 'reinforce', 'new', 'revisit'].includes(item?.strategy) ? item.strategy : 'reinforce',
    })),
    mix: {
      rescue: clampNumber(raw?.mix?.rescue, 0, 0, 1),
      reinforce: clampNumber(raw?.mix?.reinforce, 0, 0, 1),
      new: clampNumber(raw?.mix?.new, 0, 0, 1),
      revisit: clampNumber(raw?.mix?.revisit, 0, 0, 1),
    },
    risk: {
      high_volatility: Boolean(raw?.risk?.high_volatility),
      high_fatigue: Boolean(raw?.risk?.high_fatigue),
      missing_data: Boolean(raw?.risk?.missing_data),
      notes: Array.isArray(raw?.risk?.notes) ? raw.risk.notes.map((item) => String(item || '').trim()).filter(Boolean) : [],
    },
    confidence: clampNumber(raw?.confidence, 0.65, 0, 1),
  };
}

function buildRuleQueueSnapshot(queue) {
  return (Array.isArray(queue) ? queue : []).map((item, index) => ({
    question_id: item?.id || item?.question_id || '',
    rank: index + 1,
    reason: item?.plan_source === 'ai' ? 'AI 计划' : '规则候选顺序',
    suggested_interval_days: Math.max(1, Math.round(Number(item?.last_interval_days || 1))),
    priority_score: clampNumber(item?.priority_score, Math.max(1, 100 - index), 0, 100),
    strategy: item?.next_review_date && new Date(item.next_review_date) <= new Date() ? 'rescue' : 'reinforce',
  }));
}

function summarizePlannerComparison(ruleQueue, aiQueue, executionQueue, notes) {
  const ruleIds = new Set((Array.isArray(ruleQueue) ? ruleQueue : []).map((item) => item.id).filter(Boolean));
  const aiIds = new Set((Array.isArray(aiQueue) ? aiQueue : []).map((item) => item.question_id).filter(Boolean));
  const executionIds = new Set((Array.isArray(executionQueue) ? executionQueue : []).map((item) => item.id).filter(Boolean));
  const aiOverlap = [...ruleIds].filter((item) => aiIds.has(item)).length;
  const finalOverlap = [...ruleIds].filter((item) => executionIds.has(item)).length;
  const executionDueCount = (Array.isArray(executionQueue) ? executionQueue : []).filter((item) => item?.next_review_date && new Date(item.next_review_date) <= new Date()).length;
  return {
    rule_count: ruleIds.size,
    ai_count: aiIds.size,
    execution_count: executionIds.size,
    ai_rule_overlap_count: aiOverlap,
    execution_rule_overlap_count: finalOverlap,
    execution_due_count: executionDueCount,
    execution_due_ratio: executionIds.size > 0 ? Number((executionDueCount / executionIds.size).toFixed(3)) : 0,
    guardrail_notes: notes,
  };
}

function applyPlannerGuardrails({ payload, ruleQueue, plannerOutput, strategyTemplate, strategyLabel, planningLatencyMs, rolloutMetadata }) {
  const budget = Math.max(1, Number(payload?.session_constraints?.budget_count || 20));
  const questions = Array.isArray(payload?.questions) ? payload.questions : [];
  const candidateMap = new Map(questions.map((item) => [item.question_id, item]));
  const ruleMap = new Map((Array.isArray(ruleQueue) ? ruleQueue : []).map((item) => [item.id, item]));
  const notes = [];
  const normalizedQueue = [];
  const pickedIds = new Set();
  const dueCandidateIds = questions.filter((item) => item?.is_due).map((item) => item.question_id);
  const requiredDueCount = dueCandidateIds.length > 0
    ? Math.min(budget, Math.ceil(budget * Number(payload?.system_constraints?.due_min_ratio || 0)), dueCandidateIds.length)
    : 0;

  for (const item of Array.isArray(plannerOutput?.queue) ? plannerOutput.queue : []) {
    const questionId = String(item?.question_id || '').trim();
    if (!questionId) continue;
    const candidate = candidateMap.get(questionId);
    const questionRow = ruleMap.get(questionId);
    if (!candidate || !questionRow) {
      notes.push(`removed_invalid_candidate:${questionId}`);
      continue;
    }
    if (pickedIds.has(questionId)) {
      notes.push(`removed_duplicate:${questionId}`);
      continue;
    }
    if (payload?.system_constraints?.archived_excluded && (candidate.is_archived || questionRow.is_archived || questionRow.mastery_state === 'archived')) {
      notes.push(`removed_archived:${questionId}`);
      continue;
    }
    if (!candidate.is_due && Number(candidate.last_interval_days || 0) > 0 && Number(candidate.last_interval_days || 0) < Number(payload?.system_constraints?.min_interval_days || 1)) {
      notes.push(`removed_min_interval:${questionId}`);
      continue;
    }
    pickedIds.add(questionId);
    normalizedQueue.push({
      ...item,
      question_id: questionId,
      rank: normalizedQueue.length + 1,
      suggested_interval_days: Math.max(Number(payload?.system_constraints?.min_interval_days || 1), Number(item?.suggested_interval_days || 1)),
      priority_score: clampNumber(item?.priority_score, 50, 0, 100),
      strategy: item?.strategy || inferPlannerStrategy(candidate, clampNumber(item?.priority_score, 50, 0, 100)),
    });
    if (normalizedQueue.length >= budget) break;
  }

  const appendRuleQuestion = (question, reason) => {
    if (!question || pickedIds.has(question.id) || question.is_archived || question.mastery_state === 'archived') return false;
    pickedIds.add(question.id);
    normalizedQueue.push({
      question_id: question.id,
      rank: normalizedQueue.length + 1,
      reason,
      suggested_interval_days: Math.max(Number(payload?.system_constraints?.min_interval_days || 1), Math.round(Number(question.last_interval_days || 1))),
      priority_score: clampNumber(question.priority_score, 50, 0, 100),
      strategy: question.next_review_date && new Date(question.next_review_date) <= new Date() ? 'rescue' : 'reinforce',
    });
    return true;
  };

  for (const question of Array.isArray(ruleQueue) ? ruleQueue : []) {
    if (normalizedQueue.length >= budget) break;
    if (appendRuleQuestion(question, '规则补齐预算缺口')) {
      notes.push(`filled_budget:${question.id}`);
    }
  }

  const countDue = () => normalizedQueue.filter((item) => candidateMap.get(item.question_id)?.is_due).length;
  let dueCount = countDue();
  if (dueCount < requiredDueCount) {
    for (const question of Array.isArray(ruleQueue) ? ruleQueue : []) {
      if (dueCount >= requiredDueCount) break;
      const candidate = candidateMap.get(question.id);
      if (!candidate?.is_due || pickedIds.has(question.id)) continue;
      const replaceIndex = normalizedQueue.findIndex((item) => !candidateMap.get(item.question_id)?.is_due);
      if (replaceIndex >= 0) {
        const removed = normalizedQueue.splice(replaceIndex, 1)[0];
        if (removed) pickedIds.delete(removed.question_id);
      }
      if (appendRuleQuestion(question, '规则补齐 due 覆盖')) {
        notes.push(`filled_due:${question.id}`);
        dueCount = countDue();
      }
    }
  }

  const executionQueue = normalizedQueue.slice(0, budget).map((item) => ruleMap.get(item.question_id)).filter(Boolean);
  const finalDueCount = executionQueue.filter((item) => item?.next_review_date && new Date(item.next_review_date) <= new Date()).length;
  const finalDueRatio = executionQueue.length > 0 ? finalDueCount / executionQueue.length : 0;

  if (!executionQueue.length) {
    return {
      request_id: payload.request_id,
      plan_source: 'rule_fallback',
      plan_version: `${plannerOutput.plan_version}-fallback`,
      fallback_reason: 'guardrail_unrecoverable',
      planning_latency_ms: planningLatencyMs,
      strategy_template: strategyTemplate,
      strategy_label: strategyLabel,
      execution_queue: (Array.isArray(ruleQueue) ? ruleQueue : []).slice(0, budget),
      rule_queue: (Array.isArray(ruleQueue) ? ruleQueue : []).slice(0, budget),
      ai_queue: plannerOutput.queue,
      reasons: ['护栏修复后无可执行题目，已切回规则队列'],
      confidence: plannerOutput.confidence,
      comparison_summary: summarizePlannerComparison((Array.isArray(ruleQueue) ? ruleQueue : []).slice(0, budget), plannerOutput.queue, (Array.isArray(ruleQueue) ? ruleQueue : []).slice(0, budget), [...notes, 'fallback:guardrail_unrecoverable']),
      risk_flags: {
        ...plannerOutput.risk,
        strategy_template: strategyTemplate,
        strategy_label: strategyLabel,
      },
      rollout_metadata: rolloutMetadata,
    };
  }

  if (requiredDueCount > 0 && finalDueRatio < Number(payload?.system_constraints?.due_min_ratio || 0)) {
    return {
      request_id: payload.request_id,
      plan_source: 'rule_fallback',
      plan_version: `${plannerOutput.plan_version}-fallback`,
      fallback_reason: 'due_min_ratio_unmet',
      planning_latency_ms: planningLatencyMs,
      strategy_template: strategyTemplate,
      strategy_label: strategyLabel,
      execution_queue: (Array.isArray(ruleQueue) ? ruleQueue : []).slice(0, budget),
      rule_queue: (Array.isArray(ruleQueue) ? ruleQueue : []).slice(0, budget),
      ai_queue: plannerOutput.queue,
      reasons: ['AI 计划未满足 due 覆盖护栏，已切回规则队列'],
      confidence: plannerOutput.confidence,
      comparison_summary: summarizePlannerComparison((Array.isArray(ruleQueue) ? ruleQueue : []).slice(0, budget), plannerOutput.queue, (Array.isArray(ruleQueue) ? ruleQueue : []).slice(0, budget), [...notes, 'fallback:due_min_ratio_unmet']),
      risk_flags: {
        ...plannerOutput.risk,
        strategy_template: strategyTemplate,
        strategy_label: strategyLabel,
      },
      rollout_metadata: rolloutMetadata,
    };
  }

  return {
    request_id: payload.request_id,
    plan_source: 'ai',
    plan_version: plannerOutput.plan_version,
    planning_latency_ms: planningLatencyMs,
    strategy_template: strategyTemplate,
    strategy_label: strategyLabel,
    execution_queue: executionQueue,
    rule_queue: (Array.isArray(ruleQueue) ? ruleQueue : []).slice(0, budget),
    ai_queue: normalizedQueue.slice(0, budget),
    reasons: normalizedQueue.slice(0, 3).map((item) => item.reason).filter(Boolean),
    confidence: plannerOutput.confidence,
    comparison_summary: summarizePlannerComparison((Array.isArray(ruleQueue) ? ruleQueue : []).slice(0, budget), normalizedQueue.slice(0, budget), executionQueue, notes),
    risk_flags: {
      ...plannerOutput.risk,
      strategy_template: strategyTemplate,
      strategy_label: strategyLabel,
    },
    rollout_metadata: rolloutMetadata,
  };
}

async function requestPlannerOutput({ payload, strategyMeta, signal }) {
  if (!reviewAiApiKey) {
    return generateHeuristicPlannerOutput(payload, strategyMeta);
  }
  const response = await fetch(reviewAiProxyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${reviewAiApiKey}`,
    },
    body: JSON.stringify({
      model: reviewAiModel,
      stream: false,
      messages: [
        {
          role: 'system',
          content: buildPlannerPrompt(payload, strategyMeta),
        },
      ],
    }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`planner_http_${response.status}`);
  }
  const body = await response.json();
  const content = String(body?.choices?.[0]?.message?.content || '').trim();
  if (!content) {
    throw new Error('planner_empty_content');
  }
  return normalizePlannerOutput(extractPlannerJson(content), payload, strategyMeta.plan_version);
}

async function persistPlannerTelemetry(userId, payload, result) {
  const insertValues = [
    userId,
    result.request_id,
    result.plan_source,
    result.plan_version,
    result.fallback_reason || null,
    result.plan_source === 'ai',
    result.planning_latency_ms,
    JSON.stringify({
      subject: payload?.session_constraints?.subjects?.[0] || null,
      budget_count: payload?.session_constraints?.budget_count || null,
      prefer_due: Boolean(payload?.session_constraints?.prefer_due),
      strategy_template: result.strategy_template,
      strategy_label: result.strategy_label,
      rollout: result.rollout_metadata || null,
    }),
    JSON.stringify(buildRuleQueueSnapshot(result.rule_queue)),
    JSON.stringify(result.ai_queue || null),
    JSON.stringify(result.comparison_summary || null),
    JSON.stringify(result.risk_flags || null),
  ];
  await pool.query(
    `INSERT INTO review_plan_telemetry (
      user_id, request_id, plan_source, plan_version, fallback_reason, schema_validation_passed, planning_latency_ms,
      request_summary, rule_queue_snapshot, shadow_queue_snapshot, comparison_summary, risk_flags, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, NOW())`,
    insertValues,
  ).catch((err) => {
    console.warn('Failed to insert review_plan_telemetry:', err.message);
  });
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function formatHexAsUuid(hex) {
  const chars = hex.slice(0, 32).split('');
  chars[12] = '5';
  const variant = parseInt(chars[16], 16);
  chars[16] = ((variant & 0x3) | 0x8).toString(16);
  const normalized = chars.join('');
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20, 32)}`;
}

function normalizeUserId(rawUserId) {
  const cleaned = String(rawUserId || '').trim();
  if (!cleaned) return '';
  if (isUuid(cleaned)) return cleaned;
  const hash = createHash('sha256').update(cleaned).digest('hex');
  return formatHexAsUuid(hash);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(payload));
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function httpError(statusCode, message) {
  return new HttpError(statusCode, message);
}

function mapDatabaseErrorToHttp(error) {
  const code = String(error?.code || '').trim();
  if (code === '23502' || code === '22P02' || code === '22007' || code === '23514') {
    return httpError(400, String(error?.detail || error?.message || '请求参数无效'));
  }
  if (code === '23505') {
    return httpError(409, String(error?.detail || error?.message || '数据冲突'));
  }
  if (code === '23503') {
    return httpError(400, String(error?.detail || error?.message || '关联数据不存在'));
  }
  return error;
}

function mapReviewAttemptError(error) {
  const message = String(error?.message || '').trim();
  if (message === 'UNAUTHORIZED') {
    return httpError(401, '登录状态已失效，请重新登录后再试');
  }
  if (message === 'QUESTION_NOT_FOUND') {
    return httpError(404, '当前题目不存在或不属于你');
  }
  if (message === 'INVALID_RATING') {
    return httpError(400, '复习动作无效');
  }
  return mapDatabaseErrorToHttp(error);
}

async function runWithUserContext(user, executor) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT
        set_config('request.jwt.claim.sub', $1, true),
        set_config('request.jwt.claim.role', 'authenticated', true)`,
      [user.id],
    );
    const result = await executor(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function parseJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf-8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw httpError(400, '请求体 JSON 无效');
  }
}

async function resolveUser(req) {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) throw httpError(401, '缺少 access token');
  if (token === localDevFallbackAccessToken) {
    return {
      id: normalizeUserId('local-dev-user'),
      email: 'local@example.com',
    };
  }
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
    });
    if (!response.ok) {
      throw httpError(401, '无效 token');
    }
    const payload = await response.json();
    const userId = typeof payload?.id === 'string' ? payload.id : '';
    if (!userId) throw httpError(401, '无法识别用户');
    const normalizedId = normalizeUserId(userId);
    if (!normalizedId) throw httpError(401, '无法识别用户');
    return {
      id: normalizedId,
      email: typeof payload?.email === 'string' ? payload.email : null,
    };
  } catch {
    throw httpError(401, '无效 token');
  }
}

async function ensureLocalAuthUser(user) {
  await pool.query(
    `INSERT INTO auth.users (id, email)
     VALUES ($1::uuid, $2)
     ON CONFLICT (id) DO UPDATE SET
       email = COALESCE(EXCLUDED.email, auth.users.email),
       updated_at = now()`,
    [user.id, user.email ?? null],
  );
}

function boolFromQuery(value) {
  return value === '1' || value === 'true';
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeMasteryState(value) {
  const state = String(value || '').trim();
  if (!state) return 'active';
  if (state === 'active' || state === 'mastered' || state === 'archived') return state;
  return 'active';
}

function compactDistinct(values) {
  return Array.from(new Set(values.map((item) => String(item || '').trim()).filter(Boolean)));
}

async function getDefaultSubject() {
  const fromCatalog = await pool.query(
    `SELECT subject
     FROM tag_catalog
     WHERE subject IS NOT NULL AND TRIM(subject) <> ''
     ORDER BY created_at ASC
     LIMIT 1`,
  ).catch(() => ({ rows: [] }));
  if (fromCatalog.rows?.[0]?.subject) return String(fromCatalog.rows[0].subject);
  const fromQuestion = await pool.query(
    `SELECT subject
     FROM questions
     WHERE subject IS NOT NULL AND TRIM(subject) <> ''
     ORDER BY created_at ASC
     LIMIT 1`,
  ).catch(() => ({ rows: [] }));
  return String(fromQuestion.rows?.[0]?.subject || '英语');
}

async function resolveDefaultTagValue(itemType, subject) {
  const subjectText = String(subject || '').trim();
  const bySubject = await pool.query(
    `SELECT label
     FROM tag_dictionary_items
     WHERE item_type = $1 AND subject = $2
     ORDER BY sort_order ASC, created_at ASC
     LIMIT 1`,
    [itemType, subjectText],
  ).catch(() => ({ rows: [] }));
  if (bySubject.rows?.[0]?.label) return String(bySubject.rows[0].label);
  const noSubject = await pool.query(
    `SELECT label
     FROM tag_dictionary_items
     WHERE item_type = $1 AND subject IS NULL
     ORDER BY sort_order ASC, created_at ASC
     LIMIT 1`,
    [itemType],
  ).catch(() => ({ rows: [] }));
  return String(noSubject.rows?.[0]?.label || '');
}

async function buildTagDictionaryPayload() {
  const dictionaryRows = await pool.query(
    `SELECT item_type, subject, label, sort_order
     FROM tag_dictionary_items
     ORDER BY item_type, subject NULLS LAST, sort_order, label`,
  ).catch(() => ({ rows: [] }));
  const rows = dictionaryRows.rows || [];
  const grouped = {
    knowledge_point: {},
  };
  const allItems = {
    knowledge_point: [],
  };
  for (const item of rows) {
    const type = String(item.item_type || '').trim();
    if (!(type in grouped)) continue;
    const subject = String(item.subject || '').trim();
    const label = String(item.label || '').trim();
    if (!label) continue;
    allItems[type].push(label);
    if (subject) {
      if (!grouped[type][subject]) grouped[type][subject] = [];
      grouped[type][subject].push(label);
    }
  }
  const catalogRows = await pool.query(
    `SELECT tag_id, subject, tag_name, category, branch, code, created_at, updated_at
     FROM tag_catalog
     ORDER BY tag_id`,
  ).catch(() => ({ rows: [] }));
  return {
    tags: catalogRows.rows || [],
    dictionary: {
      by_subject: {
        knowledge_point: Object.fromEntries(
          Object.entries(grouped.knowledge_point).map(([key, value]) => [key, compactDistinct(value)]),
        ),
        ability: {},
        error_type: {},
      },
      all: {
        knowledge_point: compactDistinct(allItems.knowledge_point),
        ability: [],
        error_type: [],
      },
    },
  };
}

async function upsertDictionaryItem(itemType, subject, label) {
  const cleanLabel = String(label || '').trim();
  if (!cleanLabel) return;
  try {
    await pool.query(
      `INSERT INTO tag_dictionary_items (item_type, subject, label, sort_order, source, created_at, updated_at)
       VALUES ($1, $2, $3, 0, 'db', NOW(), NOW())
       ON CONFLICT (item_type, subject, label)
       DO UPDATE SET updated_at = NOW()`,
      [itemType, subject || null, cleanLabel],
    );
  } catch {
  }
}

function generateShareCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let index = 0; index < 8; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function normalizeReviewApiPathname(pathname) {
  const rawPathname = String(pathname || '').trim();
  if (!rawPathname.startsWith('/api/review') && !rawPathname.startsWith('/api/reviews')) {
    return rawPathname;
  }
  let normalizedPathname = rawPathname.replace(/^\/api\/reviews\//, '/api/review/');
  if (normalizedPathname === '/api/review/attempts') {
    normalizedPathname = '/api/review/attempt';
  }
  return normalizedPathname;
}

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) {
    sendJson(res, 400, { error: '请求无效' });
    return;
  }
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { data: { ok: true } });
    return;
  }
  const url = new URL(req.url, `http://localhost:${port}`);
  const reviewPathname = normalizeReviewApiPathname(url.pathname);
  try {
    if (url.pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, { data: { ok: true } });
      return;
    }
    const user = await resolveUser(req);
    await ensureLocalAuthUser(user);
    if (url.pathname === '/api/knowledge-nodes' && req.method === 'GET') {
      const result = await pool.query(`SELECT * FROM knowledge_nodes ORDER BY subject, category, branch, node`);
      sendJson(res, 200, { data: result.rows });
      return;
    }
    if (url.pathname === '/api/tag-dictionary' && req.method === 'GET') {
      const data = await buildTagDictionaryPayload();
      sendJson(res, 200, { data });
      return;
    }
    if (url.pathname === '/api/tag-paths' && req.method === 'GET') {
      const tagId = String(url.searchParams.get('tagId') || '').trim();
      const questionId = String(url.searchParams.get('questionId') || '').trim();
      const values = [user.id];
      const where = ['q.user_id = $1'];
      if (tagId) {
        values.push(tagId);
        where.push(`q.tag_id = $${values.length}`);
      }
      if (questionId) {
        values.push(questionId);
        where.push(`q.question_id = $${values.length}`);
      }
      const result = await pool.query(
        `SELECT q.id, q.question_id, q.tag_id, q.id_path, q.knowledge_point_id, q.subject, q.knowledge_point
         FROM questions q
         WHERE ${where.join(' AND ')}
         ORDER BY q.created_at DESC
         LIMIT 200`,
        values,
      );
      sendJson(res, 200, { data: result.rows });
      return;
    }
    if (url.pathname === '/api/tags/upsert' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const subject = String(body.subject || '').trim() || await getDefaultSubject();
      const tagName = String(body.tag_name || body.tagName || '').trim();
      const category = String(body.category || '').trim();
      const branch = String(body.branch || '').trim();
      const code = String(body.code || '').trim();
      if (!tagName) throw new Error('缺少 tag_name');
      const result = await pool.query(
        `SELECT * FROM upsert_tag_catalog($1::text, $2::text, $3::text, $4::text, $5::text)`,
        [subject, tagName, category || null, branch || null, code || null],
      );
      const row = result.rows[0];
      await upsertDictionaryItem('knowledge_point', subject, tagName);
      sendJson(res, 200, { data: row });
      return;
    }
    if (url.pathname === '/api/knowledge-points/upsert' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const subject = String(body.subject || '').trim() || await getDefaultSubject();
      const name = String(body.name || body.knowledge_point || '').trim();
      const categoryCode = String(body.category_code || body.code || '').trim();
      if (!name) throw new Error('缺少 name');
      const result = await pool.query(
        `INSERT INTO knowledge_points (subject, name, category_code, created_at)
         VALUES ($1, $2, NULLIF($3, ''), NOW())
         ON CONFLICT (subject, name)
         DO UPDATE SET category_code = COALESCE(NULLIF(EXCLUDED.category_code, ''), knowledge_points.category_code)
         RETURNING *`,
        [subject, name, categoryCode],
      );
      const row = result.rows[0];
      await upsertDictionaryItem('knowledge_point', subject, row?.name || name);
      sendJson(res, 200, { data: row });
      return;
    }
    if (url.pathname === '/api/taxonomy/upsert' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const subject = String(body.subject || '').trim() || await getDefaultSubject();
      const knowledgePoint = String(body.knowledge_point || body.name || '').trim();
      const category = String(body.category || '').trim() || '未分类';
      const branch = String(body.branch || '').trim() || '未分类';
      if (!knowledgePoint) throw new Error('缺少 knowledge_point');
      const tagResult = await pool.query(
        `SELECT * FROM upsert_tag_catalog($1::text, $2::text, $3::text, $4::text, $5::text)`,
        [subject, knowledgePoint, category, branch, null],
      );
      const tagRow = tagResult.rows[0];
      const knowledgePointResult = await pool.query(
        `INSERT INTO knowledge_points (subject, name, category_code, created_at)
         VALUES ($1, $2, NULLIF($3, ''), NOW())
         ON CONFLICT (subject, name)
         DO UPDATE SET category_code = COALESCE(NULLIF(EXCLUDED.category_code, ''), knowledge_points.category_code)
         RETURNING *`,
        [subject, knowledgePoint, String(tagRow?.code || '').trim()],
      );
      await pool.query(
        `INSERT INTO knowledge_nodes (subject, category, branch, node, tips_and_tricks, updated_at)
         VALUES ($1, $2, $3, $4, '', NOW())
         ON CONFLICT (subject, category, node)
         DO UPDATE SET branch = EXCLUDED.branch, updated_at = NOW()`,
        [subject, category, branch, knowledgePoint],
      );
      await upsertDictionaryItem('knowledge_point', subject, knowledgePoint);
      sendJson(res, 200, {
        data: {
          tag: tagRow,
          knowledge_point: knowledgePointResult.rows[0],
          node: { subject, category, branch, node: knowledgePoint },
        },
      });
      return;
    }
    if (url.pathname === '/api/knowledge-nodes/upsert' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const nodes = Array.isArray(body.nodes) ? body.nodes : [];
      if (nodes.length === 0) {
        sendJson(res, 200, { data: { ok: true } });
        return;
      }
      for (const item of nodes) {
        const subject = String(item.subject || '').trim();
        const category = String(item.category || '').trim();
        const branch = String(item.branch || '').trim() || '其他';
        const node = String(item.node || '').trim();
        const tips = String(item.tips_and_tricks || '').trim();
        if (!subject || !category || !node) continue;
        await pool.query(
          `INSERT INTO knowledge_nodes (subject, category, branch, node, tips_and_tricks, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (subject, category, node)
           DO UPDATE SET branch = EXCLUDED.branch, tips_and_tricks = EXCLUDED.tips_and_tricks, updated_at = NOW()`,
          [subject, category, branch, node, tips],
        );
      }
      sendJson(res, 200, { data: { ok: true } });
      return;
    }
    if (url.pathname === '/api/knowledge-nodes/delete' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const subject = String(body.subject || '').trim();
      const node = String(body.node || '').trim();
      const category = String(body.category || '').trim();
      if (!subject || !node) throw new Error('缺少 subject 或 node');
      if (category) {
        await pool.query(
          `DELETE FROM knowledge_nodes WHERE subject = $1 AND node = $2 AND category = $3`,
          [subject, node, category],
        );
      } else {
        await pool.query(
          `DELETE FROM knowledge_nodes WHERE subject = $1 AND node = $2`,
          [subject, node],
        );
      }
      sendJson(res, 200, { data: { ok: true } });
      return;
    }
    if (url.pathname === '/api/questions' && req.method === 'GET') {
      const values = [user.id];
      const where = ['user_id = $1'];
      const subject = url.searchParams.get('subject');
      const category = url.searchParams.get('category');
      const l2 = url.searchParams.get('l2');
      const nodesRaw = url.searchParams.get('nodes');
      const onlyDue = boolFromQuery(url.searchParams.get('onlyDue'));
      const onlyUnmastered = boolFromQuery(url.searchParams.get('onlyUnmastered'));
      const onlyStubborn = boolFromQuery(url.searchParams.get('onlyStubborn'));
      const includeArchived = boolFromQuery(url.searchParams.get('includeArchived'));
      const onlyArchived = boolFromQuery(url.searchParams.get('onlyArchived'));
      const sortBy = url.searchParams.get('sortBy');
      const limit = Number(url.searchParams.get('limit') || 0);
      const offset = Number(url.searchParams.get('offset') || 0);
      if (subject) {
        values.push(subject);
        where.push(`subject = $${values.length}`);
      }
      if (category) {
        values.push(category);
        where.push(`category = $${values.length}`);
      }
      if (l2) {
        values.push(l2);
        where.push(`knowledge_point = $${values.length}`);
      }
      if (nodesRaw) {
        const nodes = nodesRaw.split(',').map((item) => item.trim()).filter(Boolean);
        if (nodes.length > 0) {
          values.push(nodes);
          where.push(`COALESCE(node, knowledge_point) = ANY($${values.length}::text[])`);
        }
      }
      if (onlyDue) {
        where.push('(next_review_date IS NULL OR next_review_date <= NOW())');
      }
      if (onlyUnmastered) {
        where.push('COALESCE(mastery_level, ROUND(COALESCE(confidence, 0.5) * 100)) < 80');
      }
      if (onlyStubborn) {
        where.push('stubborn_flag = TRUE');
      }
      if (onlyArchived) {
        where.push('is_archived = TRUE');
      } else if (!includeArchived) {
        where.push('COALESCE(is_archived, FALSE) = FALSE');
      }
      let orderBy = 'created_at DESC';
      if (sortBy === 'lowestMastery') orderBy = 'mastery_level ASC NULLS FIRST';
      if (sortBy === 'nearestDue') orderBy = 'next_review_date ASC NULLS FIRST';
      const hasLimit = Number.isFinite(limit) && limit > 0;
      const hasOffset = Number.isFinite(offset) && offset > 0;
      let limitSql = '';
      if (hasLimit) {
        values.push(limit);
        limitSql += ` LIMIT $${values.length}`;
      }
      if (hasOffset) {
        values.push(offset);
        limitSql += ` OFFSET $${values.length}`;
      }
      const sql = `SELECT * FROM questions WHERE ${where.join(' AND ')} ORDER BY ${orderBy}${limitSql}`;
      const result = await pool.query(sql, values);
      sendJson(res, 200, { data: result.rows });
      return;
    }
    if (url.pathname === '/api/questions/signature' && req.method === 'GET') {
      const countResult = await pool.query(
        'SELECT COUNT(*)::int AS total FROM questions WHERE user_id = $1',
        [user.id],
      );
      const headResult = await pool.query(
        'SELECT id, created_at FROM questions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
        [user.id],
      );
      const total = countResult.rows[0]?.total || 0;
      const head = headResult.rows[0];
      const signature = `${total}:${head?.id || ''}:${head?.created_at || ''}`;
      sendJson(res, 200, { data: { signature } });
      return;
    }
    if (url.pathname === '/api/questions/count' && req.method === 'GET') {
      const values = [user.id];
      const where = ['user_id = $1'];
      const subject = url.searchParams.get('subject');
      const category = url.searchParams.get('category');
      const l2 = url.searchParams.get('l2');
      const nodesRaw = url.searchParams.get('nodes');
      const onlyDue = boolFromQuery(url.searchParams.get('onlyDue'));
      const onlyStubborn = boolFromQuery(url.searchParams.get('onlyStubborn'));
      const includeArchived = boolFromQuery(url.searchParams.get('includeArchived'));
      const onlyArchived = boolFromQuery(url.searchParams.get('onlyArchived'));
      if (subject) {
        values.push(subject);
        where.push(`subject = $${values.length}`);
      }
      if (category) {
        values.push(category);
        where.push(`category = $${values.length}`);
      }
      if (l2) {
        values.push(l2);
        where.push(`knowledge_point = $${values.length}`);
      }
      if (nodesRaw) {
        const nodes = nodesRaw.split(',').map((item) => item.trim()).filter(Boolean);
        if (nodes.length > 0) {
          values.push(nodes);
          where.push(`COALESCE(node, knowledge_point) = ANY($${values.length}::text[])`);
        }
      }
      if (onlyDue) {
        where.push('(next_review_date IS NULL OR next_review_date <= NOW())');
      }
      if (onlyStubborn) {
        where.push('stubborn_flag = TRUE');
      }
      if (onlyArchived) {
        where.push('is_archived = TRUE');
      } else if (!includeArchived) {
        where.push('COALESCE(is_archived, FALSE) = FALSE');
      }
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS count FROM questions WHERE ${where.join(' AND ')}`,
        values,
      );
      sendJson(res, 200, { data: { count: Number(countResult.rows[0]?.count || 0) } });
      return;
    }
    if (url.pathname === '/api/weakness' && req.method === 'GET') {
      const result = await pool.query(
        `SELECT * FROM user_weakness
         WHERE user_id = $1
         ORDER BY error_count DESC, last_updated DESC`,
        [user.id],
      );
      sendJson(res, 200, { data: result.rows });
      return;
    }
    if (url.pathname === '/api/weakness/increment' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const knowledgePoint = String(body.knowledge_point || '').trim();
      if (!knowledgePoint) throw new Error('缺少 knowledge_point');
      await pool.query(
        `INSERT INTO user_weakness (user_id, knowledge_point, ability, error_count, last_updated)
         VALUES ($1,$2,NULL,1,NOW())
         ON CONFLICT (user_id, knowledge_point)
         DO UPDATE SET error_count = user_weakness.error_count + 1, last_updated = NOW()`,
        [user.id, knowledgePoint],
      );
      sendJson(res, 200, { data: { ok: true } });
      return;
    }
    if (url.pathname === '/api/learning-state' && req.method === 'GET') {
      const result = await pool.query(
        `SELECT * FROM user_learning_state
         WHERE user_id = $1
         LIMIT 1`,
        [user.id],
      );
      const row = result.rows[0] || {
        user_id: user.id,
        tag_extensions: {},
        taxonomy_overrides: {},
        learning_content: {
          tipsByNode: {},
          drawerByTag: {},
        },
      };
      sendJson(res, 200, { data: row });
      return;
    }
    if (url.pathname === '/api/learning-state/upsert' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const result = await pool.query(
        `INSERT INTO user_learning_state (
          user_id, tag_extensions, taxonomy_overrides, learning_content, updated_at
        ) VALUES ($1,$2,$3,$4,NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
          tag_extensions = EXCLUDED.tag_extensions,
          taxonomy_overrides = EXCLUDED.taxonomy_overrides,
          learning_content = EXCLUDED.learning_content,
          updated_at = NOW()
        RETURNING *`,
        [
          user.id,
          body.tag_extensions || {},
          body.taxonomy_overrides || {},
          body.learning_content || {
            tipsByNode: {},
            drawerByTag: {},
          },
        ],
      );
      sendJson(res, 200, { data: result.rows[0] });
      return;
    }
    if (url.pathname === '/api/questions' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const subject = String(body.subject || '').trim() || await getDefaultSubject();
      const knowledgePointInput = String(body.knowledge_point || '').trim();
      const knowledgePoint = knowledgePointInput || await resolveDefaultTagValue('knowledge_point', subject) || '未分类';
      const ability = String(body.ability || '').trim();
      const errorType = String(body.error_type || '').trim();
      const insertResult = await pool.query(
        `INSERT INTO questions (
          user_id, subject, question_text, category, node, image_url, knowledge_point,
          ability, error_type, question_type, correct_answer, raw_ai_response, normalized_payload, payload_version,
          validation_status, render_mode, note, summary, confidence, mastery_level, next_review_date,
          stubborn_flag, mastery_state, mastered_at, is_archived, archived_at, review_count
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
        ) RETURNING *`,
        [
          user.id,
          subject,
          body.question_text || '',
          body.category || null,
          body.node || null,
          body.image_url || null,
          knowledgePoint,
          ability,
          errorType,
          body.question_type || null,
          body.correct_answer || null,
          body.raw_ai_response || body.question_text || '',
          body.normalized_payload || null,
          body.payload_version || null,
          body.validation_status || null,
          body.render_mode || null,
          body.note || null,
          body.summary || null,
          typeof body.confidence === 'number' ? body.confidence : null,
          typeof body.mastery_level === 'number' ? body.mastery_level : null,
          toIsoOrNull(body.next_review_date),
          Boolean(body.stubborn_flag),
          normalizeMasteryState(body.mastery_state),
          toIsoOrNull(body.mastered_at),
          Boolean(body.is_archived),
          toIsoOrNull(body.archived_at),
          Number.isFinite(Number(body.review_count)) ? Number(body.review_count) : 0,
        ],
      ).catch((error) => { throw mapDatabaseErrorToHttp(error); });
      await upsertDictionaryItem('knowledge_point', subject, knowledgePoint);
      sendJson(res, 200, { data: insertResult.rows[0] });
      return;
    }
    if (url.pathname === '/api/questions/update' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const id = String(body.id || '').trim();
      const updates = body.updates && typeof body.updates === 'object' ? body.updates : {};
      if (!id) throw new Error('缺少 id');
      const keys = Object.keys(updates).filter((key) => key !== 'id' && key !== 'user_id');
      if (keys.length === 0) throw new Error('缺少 updates');
      const values = [];
      const sets = [];
      for (const key of keys) {
        values.push(updates[key]);
        sets.push(`"${key}" = $${values.length}`);
      }
      values.push(id);
      values.push(user.id);
      const result = await pool.query(
        `UPDATE questions SET ${sets.join(', ')}
         WHERE id = $${values.length - 1} AND user_id = $${values.length}
         RETURNING *`,
        values,
      );
      if (!result.rows[0]) throw new Error('题目不存在');
      sendJson(res, 200, { data: result.rows[0] });
      return;
    }
    if (url.pathname === '/api/questions/batch-update' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
      const updates = body.updates && typeof body.updates === 'object' ? body.updates : {};
      if (ids.length === 0) {
        sendJson(res, 200, { data: { updated: 0 } });
        return;
      }
      const keys = Object.keys(updates).filter((key) => key !== 'id' && key !== 'user_id');
      if (keys.length === 0) throw new Error('缺少 updates');
      const values = [];
      const sets = [];
      for (const key of keys) {
        values.push(updates[key]);
        sets.push(`"${key}" = $${values.length}`);
      }
      values.push(ids);
      values.push(user.id);
      const result = await pool.query(
        `UPDATE questions
         SET ${sets.join(', ')}
         WHERE id = ANY($${values.length - 1}::uuid[]) AND user_id = $${values.length}
         RETURNING id`,
        values,
      );
      sendJson(res, 200, { data: { updated: result.rowCount } });
      return;
    }
    if (url.pathname === '/api/questions/delete' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const id = String(body.id || '').trim();
      if (!id) throw new Error('缺少 id');
      await pool.query(
        `DELETE FROM questions WHERE id = $1 AND user_id = $2`,
        [id, user.id],
      );
      sendJson(res, 200, { data: { ok: true } });
      return;
    }
    if (reviewPathname === '/api/review/attempt' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const questionId = String(body.questionId || '').trim();
      if (!questionId) {
        throw httpError(400, '缺少 questionId');
      }
      const rpc = await runWithUserContext(user, (client) => client.query(
        `SELECT * FROM submit_review_attempt(
          $1::uuid,$2::text,$3::boolean,$4::text,$5::text,$6::text,$7::jsonb
        )`,
        [
          questionId,
          body.userAnswer || '',
          Boolean(body.isCorrect),
          body.rating || 'vague',
          body.correctAnswer || null,
          body.selectedOptionText || null,
          body.diagnosis || {},
        ],
      )).catch((error) => {
        throw mapReviewAttemptError(error);
      });
      const questionResult = await pool.query(
        'SELECT * FROM questions WHERE id = $1 AND user_id = $2 LIMIT 1',
        [questionId, user.id],
      );
      const rpcRow = rpc.rows[0] || {};
      const question = questionResult.rows[0];
      if (!question) {
        throw new Error('复习提交成功，但读取题目快照失败');
      }
      sendJson(res, 200, {
        data: {
          attempt_id: rpcRow.attempt_id || null,
          next_review_date: rpcRow.next_review_date || question.next_review_date,
          question,
        },
      });
      return;
    }
    if (reviewPathname === '/api/review/plan-cache/rebuild' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const days = Math.max(1, Number(body.days || 14));
      await pool.query('SELECT trigger_plan_cache_rebuild($1::int)', [days]);
      sendJson(res, 200, { data: { ok: true } });
      return;
    }
    if (reviewPathname === '/api/review/global-error-stats' && req.method === 'GET') {
      const days = Math.max(1, Number(url.searchParams.get('days') || 7));
      const result = await pool.query('SELECT * FROM get_global_error_stats($1::int)', [days]);
      sendJson(res, 200, { data: result.rows });
      return;
    }
    if (reviewPathname === '/api/review/recent-attempts' && req.method === 'GET') {
      const questionId = String(url.searchParams.get('questionId') || '').trim();
      const limit = Math.max(1, Math.min(20, Number(url.searchParams.get('limit') || 6)));
      if (!questionId) throw new Error('缺少 questionId');
      const result = await pool.query(
        `SELECT id, question_id, user_answer, selected_option_text, correct_answer, is_correct, rating, ai_diagnosis, next_review_date, created_at
         FROM question_review_attempts
         WHERE user_id = $1 AND question_id = $2
         ORDER BY created_at DESC
         LIMIT $3`,
        [user.id, questionId, limit],
      );
      sendJson(res, 200, { data: result.rows });
      return;
    }
    if (url.pathname === '/api/knowledge/node-mastery' && req.method === 'GET') {
      const subject = String(url.searchParams.get('subject') || '').trim();
      if (!subject) throw new Error('缺少 subject');
      const result = await pool.query(
        'SELECT * FROM get_knowledge_node_mastery($1::uuid, $2::text)',
        [user.id, subject],
      );
      sendJson(res, 200, { data: result.rows });
      return;
    }
    if (url.pathname === '/api/stats/dashboard' && req.method === 'GET') {
      const result = await pool.query('SELECT * FROM get_dashboard_stats($1::uuid)', [user.id]);
      sendJson(res, 200, { data: result.rows[0] || null });
      return;
    }
    if (url.pathname === '/api/practice/overview' && req.method === 'GET') {
      const sessionLimit = Math.max(1, Math.min(20, Number(url.searchParams.get('sessionLimit') || 5)));
      const attemptLimit = Math.max(1, Math.min(30, Number(url.searchParams.get('attemptLimit') || 10)));
      const [sessionsResult, attemptsResult] = await Promise.all([
        pool.query(
          `SELECT id, subject, strategy, nodes, planned_amount, generated_amount, correct_count, wrong_count, total_elapsed_seconds, status, created_at, completed_at
           FROM practice_sessions
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT $2`,
          [user.id, sessionLimit],
        ),
        pool.query(
          `SELECT id, session_id, question_index, question_text, question_type, correct_answer, user_answer, is_correct, knowledge_point, duration_seconds, created_at
           FROM practice_attempts
           WHERE user_id = $1
           ORDER BY created_at DESC
           LIMIT $2`,
          [user.id, attemptLimit],
        ),
      ]);
      const sessions = sessionsResult.rows;
      const attempts = attemptsResult.rows;
      sendJson(res, 200, {
        data: {
          sessions,
          attempts,
          totals: {
            sessionCount: sessions.length,
            activeCount: sessions.filter((item) => item.status === 'active').length,
            completedCount: sessions.filter((item) => item.status === 'completed').length,
            correctCount: attempts.filter((item) => item.is_correct === true).length,
            wrongCount: attempts.filter((item) => item.is_correct === false).length,
          },
        },
      });
      return;
    }
    if (url.pathname === '/api/practice/sessions' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const result = await pool.query(
        `INSERT INTO practice_sessions (
          user_id, subject, strategy, nodes, planned_amount, generated_amount, status
        ) VALUES ($1,$2,$3,$4,$5,$6,'active') RETURNING id`,
        [
          user.id,
          body.subject,
          body.strategy,
          body.nodes || [],
          Number(body.planned_amount || 0),
          Number(body.generated_amount || 0),
        ],
      );
      sendJson(res, 200, { data: { id: result.rows[0]?.id || null } });
      return;
    }
    if (url.pathname === '/api/practice/attempts/record' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      await pool.query(
        `INSERT INTO practice_attempts (
          user_id, session_id, question_index, question_text, question_type, correct_answer, user_answer,
          is_correct, knowledge_point, duration_seconds, source_node, ai_prompt_version
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          user.id,
          body.session_id,
          Number(body.question_index || 0),
          body.question_text || '',
          body.question_type || 'essay',
          body.correct_answer || '',
          body.user_answer || '',
          Boolean(body.is_correct),
          body.knowledge_point || null,
          Number(body.duration_seconds || 0),
          body.source_node || null,
          body.ai_prompt_version || null,
        ],
      );
      sendJson(res, 200, { data: { ok: true } });
      return;
    }
    if (url.pathname === '/api/practice/attempts/submit' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const rpc = await pool.query(
        `SELECT * FROM submit_practice_attempt(
          $1::uuid,$2::int,$3::text,$4::text,$5::text,$6::text,$7::text[],$8::text,$9::text,
          $10::text,$11::text,$12::int,$13::text,$14::text,$15::boolean
        )`,
        [
          body.session_id,
          Number(body.question_index || 0),
          body.question_text || '',
          body.question_type || 'essay',
          body.correct_answer || '',
          body.user_answer || '',
          body.acceptable_answers || [],
          body.subject || '英语',
          body.knowledge_point || '',
          '',
          '',
          Number(body.duration_seconds || 0),
          body.source_node || null,
          body.ai_prompt_version || null,
          Boolean(body.is_final),
        ],
      );
      sendJson(res, 200, { data: rpc.rows[0] || { is_correct: false } });
      return;
    }
    if (url.pathname.startsWith('/api/practice/sessions/') && url.pathname.endsWith('/abandon') && req.method === 'POST') {
      const parts = url.pathname.split('/');
      const sessionId = parts[4];
      await pool.query(
        `UPDATE practice_sessions SET status = 'abandoned', completed_at = NOW()
         WHERE id = $1 AND user_id = $2 AND status = 'active'`,
        [sessionId, user.id],
      );
      sendJson(res, 200, { data: { ok: true } });
      return;
    }
    if (url.pathname === '/api/sync/import' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const mode = body.mode === 'replace' ? 'replace' : 'merge';
      const list = Array.isArray(body.questions) ? body.questions : [];
      const defaultSubject = await getDefaultSubject();
      if (mode === 'replace') {
        await pool.query('DELETE FROM questions WHERE user_id = $1', [user.id]);
      }
      let imported = 0;
      for (const item of list) {
        try {
          const subject = String(item.subject || '').trim() || defaultSubject;
          const knowledgePoint = String(item.knowledge_point || '').trim()
            || await resolveDefaultTagValue('knowledge_point', subject)
            || '未分类';
          await pool.query(
            `INSERT INTO questions (
              user_id, subject, question_text, category, node, image_url, knowledge_point,
              question_type, correct_answer, note, summary, confidence, mastery_level, next_review_date, stubborn_flag, review_count,
              mastery_state, mastered_at, is_archived, archived_at, raw_ai_response, normalized_payload, payload_version, validation_status, render_mode
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25
            )`,
            [
              user.id,
              subject,
              item.question_text || '',
              item.category || null,
              item.node || null,
              item.image_url || null,
              knowledgePoint,
              item.question_type || null,
              item.correct_answer || null,
              item.note || null,
              item.summary || null,
              typeof item.confidence === 'number' ? item.confidence : null,
              typeof item.mastery_level === 'number' ? item.mastery_level : null,
              toIsoOrNull(item.next_review_date),
              Boolean(item.stubborn_flag),
              normalizeMasteryState(item.mastery_state),
              toIsoOrNull(item.mastered_at),
              Boolean(item.is_archived),
              toIsoOrNull(item.archived_at),
              Number.isFinite(Number(item.review_count)) ? Number(item.review_count) : 0,
              item.raw_ai_response || item.question_text || '',
              item.normalized_payload || null,
              item.payload_version || null,
              item.validation_status || null,
              item.render_mode || null,
            ],
          );
          await upsertDictionaryItem('knowledge_point', subject, knowledgePoint);
          imported += 1;
        } catch {
        }
      }
      sendJson(res, 200, { data: { imported } });
      return;
    }
    if (url.pathname === '/api/sync/share-code' && req.method === 'POST') {
      const all = await pool.query('SELECT * FROM questions WHERE user_id = $1 ORDER BY created_at DESC', [user.id]);
      const payloadQuestions = all.rows.map((item) => {
        const next = { ...item };
        delete next.id;
        delete next.user_id;
        delete next.created_at;
        delete next.updated_at;
        return next;
      });
      const rpc = await pool.query('SELECT create_share_code(NULL::uuid[]) AS code');
      const rpcCode = String(rpc.rows[0]?.code || '').trim();
      if (rpcCode) {
        sendJson(res, 200, { data: { shareCode: rpcCode, count: payloadQuestions.length } });
        return;
      }
      const code = generateShareCode();
      await pool.query(
        `INSERT INTO shared_questions (code, user_id, questions, expires_at)
         VALUES ($1,$2,$3,NOW() + interval '7 days')`,
        [code, user.id, payloadQuestions],
      );
      sendJson(res, 200, { data: { shareCode: code, count: payloadQuestions.length } });
      return;
    }
    if (url.pathname === '/api/sync/import-by-code' && req.method === 'GET') {
      const code = String(url.searchParams.get('code') || '').trim().toUpperCase();
      if (!code) throw httpError(400, '缺少 code');
      const rpc = await pool.query('SELECT * FROM get_shared_questions($1::text)', [code]).catch(() => ({ rows: [] }));
      if (rpc.rows && rpc.rows.length > 0) {
        sendJson(res, 200, { data: { questions: rpc.rows } });
        return;
      }
      const result = await pool.query(
        `SELECT questions, expires_at FROM shared_questions
         WHERE code = $1
         LIMIT 1`,
        [code],
      );
      const row = result.rows[0];
      if (!row) throw httpError(404, '分享码不存在或已过期');
      if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
        throw httpError(410, '分享码已过期');
      }
      sendJson(res, 200, { data: { questions: Array.isArray(row.questions) ? row.questions : [] } });
      return;
    }
    if (reviewPathname === '/api/review/planner/shadow' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const { payload, ruleQueue } = body;
      if (!payload || !payload.request_id) {
        throw httpError(400, '缺少 payload.request_id');
      }
      const plannerOutput = generateHeuristicPlannerOutput(payload, 'local-shadow-v1');
      const shadowQueue = plannerOutput.queue;
      const planVersion = plannerOutput.plan_version;
      const latencyMs = 120;

      const telemetryResult = await pool.query(
        `INSERT INTO review_plan_telemetry (
          user_id, request_id, plan_source, plan_version, planning_latency_ms,
          request_summary, rule_queue_snapshot, shadow_queue_snapshot,
          risk_flags, schema_validation_passed, created_at
        ) VALUES ($1, $2, 'ai', $3, $4, $5, $6, $7, $8, true, NOW())
        RETURNING *`,
        [
          user.id,
          payload.request_id,
          planVersion,
          latencyMs,
          JSON.stringify({ budget_count: payload.session_constraints?.budget_count }),
          JSON.stringify(ruleQueue || []),
          JSON.stringify(shadowQueue),
          JSON.stringify({ high_volatility: false, high_fatigue: false, missing_data: false }),
        ]
      ).catch((err) => {
        // If table doesn't exist yet, we just ignore the error for now, returning mock
        console.warn('Failed to insert review_plan_telemetry:', err.message);
        return { rows: [{ 
          user_id: user.id, 
          request_id: payload.request_id, 
          plan_source: 'ai', 
          plan_version: planVersion, 
          planning_latency_ms: latencyMs, 
          request_summary: {}, 
          rule_queue_snapshot: ruleQueue, 
          shadow_queue_snapshot: shadowQueue, 
          risk_flags: {}, 
          schema_validation_passed: true 
        }] };
      });

      sendJson(res, 200, { data: telemetryResult.rows[0] });
      return;
    }
    if (reviewPathname === '/api/review/planner/live' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const payload = body?.payload;
      const ruleQueue = Array.isArray(body?.ruleQueue) ? body.ruleQueue : [];
      const strategyMeta = normalizeStrategyMeta(body?.strategyMeta || body);
      const rolloutMetadata = normalizeRolloutMetadata(body?.rolloutMetadata, payload);
      if (!payload?.request_id) {
        throw httpError(400, '缺少 payload.request_id');
      }
      const budget = Math.max(1, Number(payload?.session_constraints?.budget_count || 20));
      const trimmedRuleQueue = ruleQueue.slice(0, budget);
      const buildFallbackResult = (fallbackReason, reasons, planningLatencyMs = 0) => ({
        request_id: payload.request_id,
        plan_source: 'rule_fallback',
        plan_version: `${strategyMeta.plan_version}-fallback`,
        fallback_reason: fallbackReason,
        planning_latency_ms: planningLatencyMs,
        strategy_template: strategyMeta.strategy_template,
        strategy_label: strategyMeta.strategy_label,
        execution_queue: trimmedRuleQueue,
        rule_queue: trimmedRuleQueue,
        reasons,
        comparison_summary: summarizePlannerComparison(trimmedRuleQueue, undefined, trimmedRuleQueue, [`fallback:${fallbackReason}`]),
        risk_flags: {
          strategy_template: strategyMeta.strategy_template,
          strategy_label: strategyMeta.strategy_label,
        },
        rollout_metadata: rolloutMetadata,
      });
      if (!reviewAiPlannerEnabled && !reviewAiFallbackEnabled) {
        throw httpError(503, 'AI Planner 已关闭且未允许 fallback');
      }
      if (!rolloutMetadata.planner_enabled || !reviewAiPlannerEnabled) {
        const fallbackResult = buildFallbackResult('planner_disabled', ['AI Planner 当前已关闭，已直接切回规则队列']);
        await persistPlannerTelemetry(user.id, payload, fallbackResult);
        sendJson(res, 200, { data: fallbackResult });
        return;
      }
      if (!rolloutMetadata.selected) {
        const fallbackResult = buildFallbackResult('gray_not_selected', ['当前会话未命中 AI 灰度，沿用规则队列']);
        await persistPlannerTelemetry(user.id, payload, fallbackResult);
        sendJson(res, 200, { data: fallbackResult });
        return;
      }

      let plannerOutput;
      let planningLatencyMs = 0;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REVIEW_PLANNER_TIMEOUT_MS);
        const startedAt = Date.now();
        plannerOutput = await requestPlannerOutput({
          payload,
          strategyMeta,
          signal: controller.signal,
        });
        planningLatencyMs = Date.now() - startedAt;
        clearTimeout(timeoutId);
      } catch (error) {
        const fallbackReason = error?.name === 'AbortError' || String(error?.message || '').includes('The user aborted a request')
          ? 'planner_timeout'
          : String(error?.message || '').includes('planner_json_missing') || String(error?.message || '').includes('planner_queue_empty')
            ? 'schema_invalid'
            : 'request_failed';
        const fallbackResult = buildFallbackResult(fallbackReason, ['AI 规划失败，已自动切回规则队列'], planningLatencyMs);
        await persistPlannerTelemetry(user.id, payload, fallbackResult);
        sendJson(res, 200, { data: fallbackResult });
        return;
      }

      const result = applyPlannerGuardrails({
        payload,
        ruleQueue: trimmedRuleQueue,
        plannerOutput,
        strategyTemplate: strategyMeta.strategy_template,
        strategyLabel: strategyMeta.strategy_label,
        planningLatencyMs,
        rolloutMetadata,
      });
      await persistPlannerTelemetry(user.id, payload, result);
      sendJson(res, 200, { data: result });
      return;
    }
    sendJson(res, 404, { error: '接口不存在' });
  } catch (error) {
    const message = String(error?.message || error || '服务异常');
    const statusCode = Number(error?.statusCode);
    const normalizedStatus = Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 500;
    sendJson(res, normalizedStatus, { error: message });
  }
});

server.listen(port, () => {
  process.stdout.write(`local-api running at http://localhost:${port}\n`);
});
