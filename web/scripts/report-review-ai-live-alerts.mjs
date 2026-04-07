import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(webRoot, '..');
const localApiRoot = path.join(webRoot, 'local-api');
const reportPath = path.join(projectRoot, 'docs', 'review-ai-refactor', 'phase3-live-alert-report.md');

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
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
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

function formatPercent(value, digits = 2) {
  if (value == null) return '—';
  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function formatNumber(value, digits = 1) {
  if (value == null) return '—';
  return Number(value).toFixed(digits);
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function increment(counter, key, step = 1) {
  counter.set(key, (counter.get(key) || 0) + step);
}

function formatCounter(counter) {
  const entries = [...counter.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return String(left[0]).localeCompare(String(right[0]), 'zh-CN');
  });
  if (!entries.length) return '—';
  return entries.map(([key, count]) => `${key}=${count}`).join('，');
}

function buildAlertStatus({ totalCount, fallbackRate, timeoutCount, schemaInvalidCount, aiCount }) {
  if (totalCount === 0) {
    return {
      level: 'critical',
      summary: '当前没有 live telemetry 样本，Phase 3 无法判定是否完成。',
      actions: ['先执行 npm run drill:review-ai:live 生成样本', '再执行日报与告警脚本确认分布'],
    };
  }
  if (fallbackRate >= 0.8 || timeoutCount >= 2 || schemaInvalidCount >= 2) {
    return {
      level: 'critical',
      summary: 'fallback 或异常原因已达到高风险阈值，需要优先回查 planner 配置与输出结构。',
      actions: ['检查 fallback_reason 与 risk_flags 明细', '回查 local-api live planner 输出与请求体'],
    };
  }
  if (fallbackRate >= 0.5 || timeoutCount > 0 || schemaInvalidCount > 0 || aiCount === 0) {
    return {
      level: 'warning',
      summary: '当前存在可恢复风险，建议在继续扩量前先完成原因定位。',
      actions: ['优先查看 phase3-live-execution-report.md 的来源分布', '结合运行手册回溯具体 request_id'],
    };
  }
  return {
    level: 'healthy',
    summary: '当前 live telemetry 未发现明显异常，适合继续进行 Phase 3 收尾与后续扩量准备。',
    actions: ['保留日报与告警摘要作为交接基线', '继续积累真实 live 样本'],
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
        plan_source,
        plan_version,
        fallback_reason,
        planning_latency_ms,
        created_at
      FROM public.review_plan_telemetry
      ORDER BY created_at DESC
    `);

    const rows = result.rows || [];
    const fallbackCounter = new Map();
    const latencyValues = [];
    for (const row of rows) {
      if (row.fallback_reason) increment(fallbackCounter, String(row.fallback_reason));
      const latency = toNumber(row.planning_latency_ms);
      if (latency != null) latencyValues.push(latency);
    }

    const totalCount = rows.length;
    const aiCount = rows.filter((row) => row.plan_source === 'ai').length;
    const fallbackCount = rows.filter((row) => row.plan_source === 'rule_fallback').length;
    const timeoutCount = rows.filter((row) => row.fallback_reason === 'planner_timeout').length;
    const schemaInvalidCount = rows.filter((row) => row.fallback_reason === 'schema_invalid').length;
    const fallbackRate = totalCount > 0 ? fallbackCount / totalCount : 0;
    const status = buildAlertStatus({
      totalCount,
      fallbackRate,
      timeoutCount,
      schemaInvalidCount,
      aiCount,
    });

    const latestCreatedAt = rows[0]?.created_at ? new Date(rows[0].created_at).toISOString() : '—';
    const markdown = `# Phase 3 AI Live 告警摘要

## 报表信息
- 生成时间：\`${generatedAt}\`
- 数据源：\`local-api\` 本地数据库
- 数据库连接：\`${databaseUrl.replace(/:[^:@/]+@/, ':****@')}\`
- 最近样本时间：\`${latestCreatedAt}\`

## 状态
- 当前级别：\`${status.level}\`
- 结论：${status.summary}

## 指标
- 样本量：\`${totalCount}\`
- AI 样本量：\`${aiCount}\`
- fallback 样本量：\`${fallbackCount}\`
- fallback 占比：\`${formatPercent(fallbackRate)}\`
- planner_timeout 次数：\`${timeoutCount}\`
- schema_invalid 次数：\`${schemaInvalidCount}\`
- 平均规划延迟：\`${formatNumber(average(latencyValues))} ms\`
- fallback 原因分布：${formatCounter(fallbackCounter)}

## 建议动作
${status.actions.map((item) => `- ${item}`).join('\n')}
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
