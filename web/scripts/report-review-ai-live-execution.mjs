import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(webRoot, '..');
const localApiRoot = path.join(webRoot, 'local-api');
const reportPath = path.join(projectRoot, 'docs', 'review-ai-refactor', 'phase3-live-execution-report.md');

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
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
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatNumber(value, digits = 2) {
  if (value == null) return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return numeric.toFixed(digits);
}

function formatPercent(value, digits = 2) {
  if (value == null) return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return `${(numeric * 100).toFixed(digits)}%`;
}

function increment(counter, key, step = 1) {
  counter.set(key, (counter.get(key) || 0) + step);
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sortCounter(counter, limit = 10) {
  return [...counter.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return String(left[0]).localeCompare(String(right[0]), 'zh-CN');
    })
    .slice(0, limit);
}

function formatCounter(counter, limit = 10) {
  const entries = sortCounter(counter, limit);
  if (!entries.length) return '—';
  return entries.map(([key, count]) => `${key}=${count}`).join('，');
}

async function main() {
  loadEnvFile(path.join(localApiRoot, '.env'));
  loadEnvFile(path.join(localApiRoot, '.env.example'));

  const databaseUrl = String(process.env.DATABASE_URL || process.env.LOCAL_DATABASE_URL || '').trim();
  if (!databaseUrl) {
    throw new Error('缺少 DATABASE_URL 或 LOCAL_DATABASE_URL');
  }

  const shouldWrite = process.argv.includes('--write');
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    const generatedAt = new Date().toISOString();
    const result = await client.query(`
      SELECT
        request_id,
        plan_source,
        plan_version,
        fallback_reason,
        planning_latency_ms,
        request_summary,
        comparison_summary,
        risk_flags,
        created_at
      FROM public.review_plan_telemetry
      ORDER BY created_at DESC
    `);

    const rows = result.rows || [];
    if (!rows.length) {
      const emptyMarkdown = `# Review AI Live 执行日报

## 报表信息
- 生成时间：\`${generatedAt}\`
- 数据源：\`local-api\` 本地数据库
- 数据库连接：\`${databaseUrl.replace(/:[^:@/]+@/, ':****@')}\`
- 统计对象：\`public.review_plan_telemetry\`

## 总览
- 当前尚无 live planner 遥测数据，无法生成 AI 执行日报。
- 请先在复习页启动至少一次复习会话，再重新执行 \`npm run report:review-ai:live-execution\`。
`;
      if (shouldWrite) {
        mkdirSync(path.dirname(reportPath), { recursive: true });
        writeFileSync(reportPath, emptyMarkdown, 'utf-8');
      }
      process.stdout.write(emptyMarkdown);
      return;
    }

    const planSourceCounter = new Map();
    const fallbackCounter = new Map();
    const strategyCounter = new Map();
    const planVersionCounter = new Map();
    const rolloutSelectedCounter = new Map();
    const rolloutPercentCounter = new Map();
    const rolloutBucketCounter = new Map();
    const riskCounter = new Map();
    const latencyValues = [];
    const aiLatencyValues = [];
    const executionQueueSizes = [];
    const dueRatios = [];
    const sampleRows = [];

    for (const row of rows) {
      increment(planSourceCounter, String(row.plan_source || 'unknown'));
      if (row.fallback_reason) increment(fallbackCounter, String(row.fallback_reason));

      const latency = toNumber(row.planning_latency_ms);
      if (latency != null) {
        latencyValues.push(latency);
        if (row.plan_source === 'ai') aiLatencyValues.push(latency);
      }

      const requestSummary = row.request_summary && typeof row.request_summary === 'object' ? row.request_summary : {};
      const comparisonSummary = row.comparison_summary && typeof row.comparison_summary === 'object' ? row.comparison_summary : {};
      const riskFlags = row.risk_flags && typeof row.risk_flags === 'object' ? row.risk_flags : {};
      const rollout = requestSummary.rollout && typeof requestSummary.rollout === 'object' ? requestSummary.rollout : {};

      increment(strategyCounter, String(
        riskFlags.strategy_label
        || requestSummary.strategy_label
        || requestSummary.strategy_template
        || riskFlags.strategy_template
        || '未标记',
      ));
      increment(planVersionCounter, String(row.plan_version || '未标记'));
      increment(rolloutSelectedCounter, String(Boolean(rollout.selected)));
      increment(rolloutPercentCounter, String(rollout.gray_percent ?? '未标记'));
      increment(rolloutBucketCounter, String(rollout.gray_bucket ?? '未标记'));

      const executionCount = toNumber(comparisonSummary.execution_count);
      const dueRatio = toNumber(comparisonSummary.execution_due_ratio);
      if (executionCount != null) executionQueueSizes.push(executionCount);
      if (dueRatio != null) dueRatios.push(dueRatio);

      for (const [key, value] of Object.entries(riskFlags)) {
        if (key === 'strategy_template' || key === 'strategy_label') continue;
        if (value) increment(riskCounter, key);
      }

      if (sampleRows.length < 5) {
        sampleRows.push({
          requestId: row.request_id,
          createdAt: row.created_at,
          planSource: row.plan_source,
          fallbackReason: row.fallback_reason || '—',
          strategyLabel: String(riskFlags.strategy_label || requestSummary.strategy_label || '未标记'),
          planVersion: String(row.plan_version || '未标记'),
          rolloutSelected: String(Boolean(rollout.selected)),
          rolloutPercent: rollout.gray_percent ?? '—',
          latencyMs: latency,
          executionCount,
        });
      }
    }

    const totalCount = rows.length;
    const aiCount = planSourceCounter.get('ai') || 0;
    const fallbackCount = planSourceCounter.get('rule_fallback') || 0;
    const markdown = `# Review AI Live 执行日报

## 报表信息
- 生成时间：\`${generatedAt}\`
- 数据源：\`local-api\` 本地数据库
- 数据库连接：\`${databaseUrl.replace(/:[^:@/]+@/, ':****@')}\`
- 统计对象：\`public.review_plan_telemetry\`
- 样本量：\`${totalCount}\`

## 总览
- AI 执行占比：\`${formatPercent(totalCount > 0 ? aiCount / totalCount : null)}\`
- 规则 fallback 占比：\`${formatPercent(totalCount > 0 ? fallbackCount / totalCount : null)}\`
- 全量平均规划延迟：\`${formatNumber(average(latencyValues), 1)} ms\`
- AI 成功平均规划延迟：\`${formatNumber(average(aiLatencyValues), 1)} ms\`
- 平均执行队列长度：\`${formatNumber(average(executionQueueSizes), 2)}\`
- 平均 due 覆盖率：\`${formatPercent(average(dueRatios))}\`

## 分布摘要
- 计划来源分布：${formatCounter(planSourceCounter)}
- fallback 原因分布：${formatCounter(fallbackCounter)}
- rollout selected 分布：${formatCounter(rolloutSelectedCounter)}
- rollout percent 分布：${formatCounter(rolloutPercentCounter)}
- rollout bucket 分布：${formatCounter(rolloutBucketCounter)}
- 策略模板分布：${formatCounter(strategyCounter)}
- plan_version 分布：${formatCounter(planVersionCounter)}
- 风险标记分布：${formatCounter(riskCounter)}

## 样本
| request_id | created_at | plan_source | fallback_reason | strategy | plan_version | rollout_selected | rollout_percent | latency_ms | execution_count |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: |
${sampleRows.map((row) => `| ${row.requestId} | ${row.createdAt} | ${row.planSource} | ${row.fallbackReason} | ${row.strategyLabel} | ${row.planVersion} | ${row.rolloutSelected} | ${row.rolloutPercent} | ${row.latencyMs ?? '—'} | ${row.executionCount ?? '—'} |`).join('\n')}

## 结论
- 当前日报已覆盖 AI 占比、fallback 率、rollout 命中、计划版本、策略模板与风险标记，可作为 Phase 4 扩量观测入口。
- 若 fallback 占比持续高于预期，优先回查 \`fallback_reason\`、\`request_summary.rollout\` 与 \`plan_version\`，确认是灰度命中问题、模型问题还是护栏问题。
`;

    if (shouldWrite) {
      mkdirSync(path.dirname(reportPath), { recursive: true });
      writeFileSync(reportPath, markdown, 'utf-8');
    }
    process.stdout.write(markdown);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
});
