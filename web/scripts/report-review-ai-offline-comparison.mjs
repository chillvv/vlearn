import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(webRoot, '..');
const localApiRoot = path.join(webRoot, 'local-api');
const reportPath = path.join(projectRoot, 'docs', 'review-ai-refactor', 'phase2-offline-comparison-report.md');

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

function toArray(value) {
  return Array.isArray(value) ? value : [];
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

function sortCountEntries(counter) {
  return [...counter.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return String(a[0]).localeCompare(String(b[0]), 'zh-CN');
  });
}

function formatCounter(counter, limit = 10) {
  const entries = sortCountEntries(counter).slice(0, limit);
  if (!entries.length) return '—';
  return entries.map(([key, count]) => `${key}=${count}`).join('，');
}

function normalizeQuestionId(item) {
  return String(
    item?.question_id ||
    item?.questionId ||
    item?.id ||
    '',
  ).trim();
}

function normalizePriorityScore(item) {
  return toNumber(item?.priority_score ?? item?.priorityScore ?? item?.priority);
}

function normalizeReason(item) {
  const text = String(item?.reason || item?.reason_text || '').trim();
  return text || '未标记';
}

function normalizeStrategy(item) {
  const text = String(item?.strategy || '').trim();
  return text || '未标记';
}

function getPriorityBucket(value) {
  if (value == null) return 'NULL';
  if (value <= 0) return '0';
  if (value < 40) return '0-40';
  if (value < 60) return '40-60';
  if (value < 80) return '60-80';
  if (value <= 100) return '80-100';
  return '100+';
}

function increment(counter, key, step = 1) {
  counter.set(key, (counter.get(key) || 0) + step);
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarizeOverlap(ruleQueue, shadowQueue) {
  const ruleIds = new Set(ruleQueue.map(normalizeQuestionId).filter(Boolean));
  const shadowIds = new Set(shadowQueue.map(normalizeQuestionId).filter(Boolean));
  const overlapCount = [...ruleIds].filter((id) => shadowIds.has(id)).length;
  const ruleOverlapRate = ruleIds.size > 0 ? overlapCount / ruleIds.size : null;
  const shadowOverlapRate = shadowIds.size > 0 ? overlapCount / shadowIds.size : null;
  const unionSize = new Set([...ruleIds, ...shadowIds]).size;
  const jaccardRate = unionSize > 0 ? overlapCount / unionSize : null;
  return {
    ruleCount: ruleIds.size,
    shadowCount: shadowIds.size,
    overlapCount,
    ruleOverlapRate,
    shadowOverlapRate,
    jaccardRate,
  };
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
        plan_version,
        planning_latency_ms,
        created_at,
        request_summary,
        rule_queue_snapshot,
        shadow_queue_snapshot,
        risk_flags
      FROM public.review_plan_telemetry
      ORDER BY created_at DESC
    `);

    const rows = result.rows || [];
    if (!rows.length) {
      const emptyMarkdown = `# Phase 2 离线收益对比报告

## 报表信息
- 生成时间：\`${generatedAt}\`
- 数据源：\`local-api\` 本地数据库
- 数据库连接：\`${databaseUrl.replace(/:[^:@/]+@/, ':****@')}\`
- 统计对象：\`public.review_plan_telemetry\`

## 总览
- 当前尚无 shadow 遥测数据，无法计算 AI 队列与规则队列的离线收益对比。
- 请先在复习页触发至少一次 shadow 调用，再重新执行 \`npm run report:review-ai:offline-comparison\`。
`;
      if (shouldWrite) {
        mkdirSync(path.dirname(reportPath), { recursive: true });
        writeFileSync(reportPath, emptyMarkdown, 'utf-8');
      }
      process.stdout.write(emptyMarkdown);
      return;
    }

    const rulePriorityBuckets = new Map();
    const shadowPriorityBuckets = new Map();
    const reasonCounter = new Map();
    const strategyCounter = new Map();
    const riskCounter = new Map();
    const ruleOverlapRates = [];
    const shadowOverlapRates = [];
    const jaccardRates = [];
    const latencyValues = [];
    const ruleQueueSizes = [];
    const shadowQueueSizes = [];
    const overlapCounts = [];
    const globalRuleIds = new Set();
    const globalShadowIds = new Set();
    const sampleRows = [];

    for (const row of rows) {
      const ruleQueue = toArray(row.rule_queue_snapshot);
      const shadowQueue = toArray(row.shadow_queue_snapshot);
      const overlap = summarizeOverlap(ruleQueue, shadowQueue);
      const latencyMs = toNumber(row.planning_latency_ms);

      if (latencyMs != null) latencyValues.push(latencyMs);
      ruleQueueSizes.push(overlap.ruleCount);
      shadowQueueSizes.push(overlap.shadowCount);
      overlapCounts.push(overlap.overlapCount);
      if (overlap.ruleOverlapRate != null) ruleOverlapRates.push(overlap.ruleOverlapRate);
      if (overlap.shadowOverlapRate != null) shadowOverlapRates.push(overlap.shadowOverlapRate);
      if (overlap.jaccardRate != null) jaccardRates.push(overlap.jaccardRate);

      for (const item of ruleQueue) {
        const id = normalizeQuestionId(item);
        if (id) globalRuleIds.add(id);
        increment(rulePriorityBuckets, getPriorityBucket(normalizePriorityScore(item)));
      }

      for (const item of shadowQueue) {
        const id = normalizeQuestionId(item);
        if (id) globalShadowIds.add(id);
        increment(shadowPriorityBuckets, getPriorityBucket(normalizePriorityScore(item)));
        increment(reasonCounter, normalizeReason(item));
        increment(strategyCounter, normalizeStrategy(item));
      }

      const riskFlags = row.risk_flags && typeof row.risk_flags === 'object' ? row.risk_flags : {};
      for (const [key, value] of Object.entries(riskFlags)) {
        if (value) increment(riskCounter, key);
      }

      if (sampleRows.length < 5) {
        sampleRows.push({
          requestId: row.request_id,
          createdAt: row.created_at,
          overlapRuleRate: overlap.ruleOverlapRate,
          overlapCount: overlap.overlapCount,
          ruleCount: overlap.ruleCount,
          shadowCount: overlap.shadowCount,
          latencyMs,
        });
      }
    }

    const globalOverlapCount = [...globalRuleIds].filter((id) => globalShadowIds.has(id)).length;
    const globalRuleOverlapRate = globalRuleIds.size > 0 ? globalOverlapCount / globalRuleIds.size : null;
    const globalShadowOverlapRate = globalShadowIds.size > 0 ? globalOverlapCount / globalShadowIds.size : null;
    const globalUnionSize = new Set([...globalRuleIds, ...globalShadowIds]).size;
    const globalJaccardRate = globalUnionSize > 0 ? globalOverlapCount / globalUnionSize : null;

    const markdown = `# Phase 2 离线收益对比报告

## 报表信息
- 生成时间：\`${generatedAt}\`
- 数据源：\`local-api\` 本地数据库
- 数据库连接：\`${databaseUrl.replace(/:[^:@/]+@/, ':****@')}\`
- 统计对象：\`public.review_plan_telemetry\`

## 总览
| 指标 | 值 |
| --- | --- |
| telemetry 样本数 | ${rows.length} |
| 唯一规则队列题数 | ${globalRuleIds.size} |
| 唯一 AI 队列题数 | ${globalShadowIds.size} |
| 全局交集题数 | ${globalOverlapCount} |
| 平均规则队列长度 | ${formatNumber(average(ruleQueueSizes))} |
| 平均 AI 队列长度 | ${formatNumber(average(shadowQueueSizes))} |
| 平均交集题数 | ${formatNumber(average(overlapCounts))} |
| 平均规则覆盖重合率 | ${formatPercent(average(ruleOverlapRates))} |
| 平均 AI 覆盖重合率 | ${formatPercent(average(shadowOverlapRates))} |
| 平均 Jaccard 重合率 | ${formatPercent(average(jaccardRates))} |
| 全局规则覆盖重合率 | ${formatPercent(globalRuleOverlapRate)} |
| 全局 AI 覆盖重合率 | ${formatPercent(globalShadowOverlapRate)} |
| 全局 Jaccard 重合率 | ${formatPercent(globalJaccardRate)} |
| 平均规划延迟 | ${formatNumber(average(latencyValues))} ms |

## 会话样本
| request_id | created_at | 规则队列长度 | AI 队列长度 | 交集题数 | 规则覆盖重合率 | 规划延迟 |
| --- | --- | --- | --- | --- | --- | --- |
${sampleRows.map((row) => `| ${row.requestId} | ${row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt} | ${row.ruleCount} | ${row.shadowCount} | ${row.overlapCount} | ${formatPercent(row.overlapRuleRate)} | ${row.latencyMs == null ? '—' : `${row.latencyMs} ms`} |`).join('\n')}

## 推荐理由与策略分布
| 维度 | 分布 |
| --- | --- |
| AI 推荐理由 Top10 | ${formatCounter(reasonCounter, 10)} |
| AI 策略分布 | ${formatCounter(strategyCounter, 10)} |
| 风险标记 | ${formatCounter(riskCounter, 10)} |

## 优先级分布对比
| 队列 | 分布摘要 |
| --- | --- |
| 规则队列 priority_score | ${formatCounter(rulePriorityBuckets, 10)} |
| AI 队列 priority_score | ${formatCounter(shadowPriorityBuckets, 10)} |

## 结论
- 当前离线报表已能读取 \`review_plan_telemetry\`，并输出规则队列与 AI 队列的重合率、策略分布和优先级分布。
- 若平均规则覆盖重合率偏低，说明 AI 队列和规则队列分歧较大，进入 Phase 3 前应先复核 prompt、约束和输入特征。
- 若平均规划延迟持续升高，应优先结合已接入的超时/重试策略评估 shadow 调用稳定性。
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

await main();
