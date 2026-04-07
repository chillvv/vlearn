import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(webRoot, '..');
const localApiEntry = path.join(webRoot, 'local-api', 'server.mjs');
const reportPath = path.join(projectRoot, 'docs', 'review-ai-refactor', 'phase3-live-drill-report.md');
const defaultPorts = [18080, 18081];

function loadEnvFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separatorIndex = line.indexOf('=');
      if (separatorIndex <= 0) continue;
      const key = line.slice(0, separatorIndex).trim();
      let value = line.slice(separatorIndex + 1).trim();
      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith('\'') && value.endsWith('\''))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodeBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createLocalToken(userId, email = 'local-review-ai@example.com') {
  const header = encodeBase64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = encodeBase64Url(JSON.stringify({
    sub: userId,
    email,
    exp: 4102444800,
  }));
  return `${header}.${payload}.local`;
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function waitForServerReady(baseUrl, token, attempts = 40) {
  let lastError = null;
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/questions?limit=1`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw lastError || new Error('local-api 未就绪');
}

async function startLocalApi(port, envOverrides) {
  const stdout = [];
  const stderr = [];
  const child = spawn(process.execPath, [localApiEntry], {
    cwd: webRoot,
    env: {
      ...process.env,
      PORT: String(port),
      ...envOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => {
    stdout.push(String(chunk));
  });
  child.stderr?.on('data', (chunk) => {
    stderr.push(String(chunk));
  });
  child.on('error', (error) => {
    stderr.push(String(error?.message || error));
  });
  return {
    child,
    stdout,
    stderr,
  };
}

async function stopLocalApi(serverProcess) {
  if (!serverProcess || serverProcess.killed) return;
  const stopped = await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    serverProcess.once('exit', finish);
    try {
      serverProcess.kill('SIGINT');
    } catch {
      finish();
      return;
    }
    setTimeout(() => {
      if (!settled) {
        try {
          serverProcess.kill('SIGTERM');
        } catch {
        }
      }
    }, 1200);
    setTimeout(finish, 2500);
  });
  return stopped;
}

async function pickSampleUser(pool, minQuestions) {
  const result = await pool.query(
    `SELECT user_id::text AS user_id, COUNT(*)::int AS total
     FROM public.questions
     WHERE COALESCE(is_archived, FALSE) = FALSE
     GROUP BY user_id
     HAVING COUNT(*) >= $1
     ORDER BY COUNT(*) DESC, user_id
     LIMIT 1`,
    [minQuestions],
  );
  const row = result.rows[0];
  if (!row?.user_id) {
    throw new Error(`未找到至少 ${minQuestions} 道可用题目的用户样本`);
  }
  return {
    userId: String(row.user_id),
    total: Number(row.total || 0),
  };
}

async function loadRuleQueue(pool, userId, limit) {
  const result = await pool.query(
    `SELECT
       id,
       question_id,
       subject,
       knowledge_point,
       mastery_state,
       review_count,
       last_interval_days,
       lapse_count,
       stability,
       difficulty,
       predicted_recall,
       priority_score,
       next_review_date,
       is_archived,
       created_at
     FROM public.questions
     WHERE user_id = $1
       AND COALESCE(is_archived, FALSE) = FALSE
     ORDER BY
       CASE WHEN next_review_date IS NULL THEN 1 ELSE 0 END,
       next_review_date ASC NULLS LAST,
       COALESCE(priority_score, 0) DESC,
       created_at ASC
     LIMIT $2`,
    [userId, limit],
  );
  if (!result.rows.length) {
    throw new Error(`用户 ${userId} 没有可用于演练的题目`);
  }
  return result.rows.map((row) => ({
    ...row,
    id: String(row.id),
    question_id: row.question_id ? String(row.question_id) : null,
    subject: String(row.subject || '英语'),
    knowledge_point: row.knowledge_point ? String(row.knowledge_point) : '',
    mastery_state: String(row.mastery_state || 'active'),
    review_count: toNumber(row.review_count),
    last_interval_days: toNumber(row.last_interval_days),
    lapse_count: toNumber(row.lapse_count),
    stability: toNumber(row.stability),
    difficulty: toNumber(row.difficulty, 0.5),
    predicted_recall: toNumber(row.predicted_recall),
    priority_score: toNumber(row.priority_score),
    next_review_date: toIsoOrNull(row.next_review_date),
    is_archived: Boolean(row.is_archived),
  }));
}

function buildPlannerInput(userId, subject, ruleQueue, budgetCount, dueMinRatio, scope) {
  return {
    request_id: crypto.randomUUID(),
    request_at: new Date().toISOString(),
    user: {
      user_id: userId,
      stats_7d: { review_count: 0, accuracy: 0, interruption_rate: 0 },
      stats_30d: { review_count: 0, accuracy: 0, interruption_rate: 0 },
      subject_preference: [subject],
    },
    session_constraints: {
      budget_count: budgetCount,
      prefer_due: scope === 'due',
      subjects: [subject],
    },
    system_constraints: {
      min_interval_days: 1,
      max_session_count: 5,
      due_min_ratio: dueMinRatio,
      archived_excluded: true,
    },
    questions: ruleQueue.map((question) => ({
      question_id: question.id,
      subject: question.subject,
      knowledge_point: question.knowledge_point,
      mastery_state: question.mastery_state || 'active',
      review_count: question.review_count || 0,
      last_result: 'unknown',
      last_interval_days: question.last_interval_days || 0,
      lapse_count: question.lapse_count || 0,
      stability: question.stability || 0,
      difficulty: question.difficulty || 0.5,
      predicted_recall: question.predicted_recall || 0,
      is_due: !!question.next_review_date && new Date(question.next_review_date) <= new Date(),
      is_archived: !!question.is_archived,
    })),
  };
}

function buildStrategyTemplate(scope, ruleQueue, dueMinRatio) {
  const dueCount = ruleQueue.filter((item) => !!item.next_review_date && new Date(item.next_review_date) <= new Date()).length;
  const dueRatio = ruleQueue.length > 0 ? dueCount / ruleQueue.length : 0;
  if (scope === 'due' || dueRatio >= Math.max(dueMinRatio, 0.6)) {
    return {
      strategy_template: 'due-rescue',
      strategy_label: '到期抢救',
      prompt_hint: '优先保障 due 题覆盖，先处理遗忘风险最高与已逾期题目。',
      plan_version: 'review-ai-live-v2-due-rescue',
      weighting_profile: {
        due: 52,
        recall: 24,
        lapse: 8,
        stability: 10,
        difficulty: 4,
        new_question: 2,
      },
    };
  }
  return {
    strategy_template: 'daily-reinforce',
    strategy_label: '日常巩固',
    prompt_hint: '平衡抢救、巩固与回访，避免单一高压刷题。',
    plan_version: 'review-ai-live-v2-daily-reinforce',
    weighting_profile: {
      due: 24,
      recall: 28,
      lapse: 12,
      stability: 16,
      difficulty: 10,
      new_question: 6,
    },
  };
}

async function loadTelemetryRow(pool, requestId) {
  const result = await pool.query(
    `SELECT request_id, plan_source, plan_version, fallback_reason, planning_latency_ms, created_at
     FROM public.review_plan_telemetry
     WHERE request_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [requestId],
  );
  return result.rows[0] || null;
}

async function runDrillCase({
  label,
  port,
  token,
  payload,
  ruleQueue,
  strategyMeta,
  plannerEnabled,
  rolloutSelected,
  pool,
}) {
  const server = await startLocalApi(port, {
    REVIEW_AI_PLANNER_ENABLED: plannerEnabled ? 'true' : 'false',
    REVIEW_AI_FALLBACK_ENABLED: 'true',
    REVIEW_AI_API_KEY: '',
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForServerReady(baseUrl, token);
    const response = await fetch(`${baseUrl}/api/review/planner/live`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        payload,
        ruleQueue,
        strategyMeta,
        rolloutMetadata: {
          planner_enabled: plannerEnabled,
          gray_percent: rolloutSelected ? 100 : 0,
          gray_bucket: rolloutSelected ? 0 : 99,
          selected: rolloutSelected,
          page_number: 1,
        },
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`${label} 请求失败：HTTP ${response.status} ${body?.error || ''}`.trim());
    }
    const result = body?.data;
    if (!result?.request_id) {
      throw new Error(`${label} 返回缺少 request_id`);
    }
    const telemetry = await loadTelemetryRow(pool, result.request_id);
    if (!telemetry) {
      throw new Error(`${label} 未找到 telemetry 写入结果`);
    }
    return {
      label,
      requestId: String(result.request_id),
      planSource: String(result.plan_source || telemetry.plan_source || ''),
      planVersion: String(result.plan_version || telemetry.plan_version || ''),
      fallbackReason: result.fallback_reason || telemetry.fallback_reason || '—',
      latencyMs: toNumber(result.planning_latency_ms ?? telemetry.planning_latency_ms, 0),
      createdAt: telemetry.created_at ? new Date(telemetry.created_at).toISOString() : new Date().toISOString(),
    };
  } catch (error) {
    const output = `${server.stdout.join('')}\n${server.stderr.join('')}`.trim();
    throw new Error(`${error?.message || error}${output ? `\n\nlocal-api 输出：\n${output}` : ''}`);
  } finally {
    await stopLocalApi(server.child);
  }
}

function renderMarkdown({ generatedAt, subject, userId, sampledCount, cases }) {
  return `# Phase 3 AI Live 演练记录

## 报表信息
- 生成时间：\`${generatedAt}\`
- 演练用户：\`${userId}\`
- 演练学科：\`${subject}\`
- 候选题数：\`${sampledCount}\`

## 样本结果
| case | request_id | plan_source | plan_version | fallback_reason | latency_ms | created_at |
| --- | --- | --- | --- | --- | ---: | --- |
${cases.map((item) => `| ${item.label} | ${item.requestId} | ${item.planSource} | ${item.planVersion} | ${item.fallbackReason} | ${item.latencyMs} | ${item.createdAt} |`).join('\n')}

## 结论
- 本次演练同时生成 AI 成功与规则 fallback 两类 telemetry 样本，可直接用于 Phase 3 日报与告警摘要。
- 若后续需要继续扩充样本，可重复执行 \`npm run drill:review-ai:live\`。
- 下一步建议依次执行 \`npm run report:review-ai:live-execution\` 与 \`npm run report:review-ai:live-alerts\`。
`;
}

async function main() {
  loadEnvFile(path.join(webRoot, 'local-api', '.env'));
  loadEnvFile(path.join(webRoot, 'local-api', '.env.example'));

  const databaseUrl = String(process.env.DATABASE_URL || process.env.LOCAL_DATABASE_URL || '').trim();
  if (!databaseUrl) {
    throw new Error('缺少 DATABASE_URL 或 LOCAL_DATABASE_URL');
  }

  const shouldWrite = process.argv.includes('--write');
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const sampleUser = await pickSampleUser(pool, 3);
    const ruleQueue = await loadRuleQueue(pool, sampleUser.userId, 8);
    const subject = String(ruleQueue[0]?.subject || '英语');
    const budgetCount = Math.max(1, Math.min(6, ruleQueue.length));
    const dueMinRatio = 0.4;
    const dueCount = ruleQueue.filter((item) => !!item.next_review_date && new Date(item.next_review_date) <= new Date()).length;
    const scope = dueCount > 0 ? 'due' : 'all';
    const strategy = buildStrategyTemplate(scope, ruleQueue, dueMinRatio);
    const token = createLocalToken(sampleUser.userId);

    const aiPayload = buildPlannerInput(sampleUser.userId, subject, ruleQueue, budgetCount, dueMinRatio, scope);
    const fallbackPayload = buildPlannerInput(sampleUser.userId, subject, ruleQueue, budgetCount, dueMinRatio, scope);

    const aiCase = await runDrillCase({
      label: 'ai-live',
      port: defaultPorts[0],
      token,
      payload: aiPayload,
      ruleQueue,
      strategyMeta: strategy,
      plannerEnabled: true,
      rolloutSelected: true,
      pool,
    });
    if (aiCase.planSource !== 'ai') {
      throw new Error(`AI 演练未生成 ai 样本，实际为 ${aiCase.planSource}`);
    }

    const fallbackCase = await runDrillCase({
      label: 'planner-disabled-fallback',
      port: defaultPorts[1],
      token,
      payload: fallbackPayload,
      ruleQueue,
      strategyMeta: strategy,
      plannerEnabled: false,
      rolloutSelected: false,
      pool,
    });
    if (fallbackCase.planSource !== 'rule_fallback') {
      throw new Error(`Fallback 演练未生成 rule_fallback 样本，实际为 ${fallbackCase.planSource}`);
    }

    const cases = [aiCase, fallbackCase];
    const markdown = renderMarkdown({
      generatedAt: new Date().toISOString(),
      subject,
      userId: sampleUser.userId,
      sampledCount: ruleQueue.length,
      cases,
    });
    if (shouldWrite) {
      mkdirSync(path.dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, markdown, 'utf-8');
    }
    process.stdout.write(markdown);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
});
