import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(webRoot, '..');
const localApiRoot = path.join(webRoot, 'local-api');
const reportPath = path.join(projectRoot, 'docs', 'review-ai-refactor', 'phase0-baseline-report.md');

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
    const attemptSummaryResult = await client.query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS attempts_7d,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days' AND is_correct = TRUE)::int AS correct_attempts_7d,
          COUNT(DISTINCT question_id) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS questions_7d
        FROM public.question_review_attempts
      `);
    const retrySummaryResult = await client.query(`
        WITH ordered_attempts AS (
          SELECT
            user_id,
            question_id,
            is_correct,
            created_at,
            LEAD(is_correct) OVER (PARTITION BY user_id, question_id ORDER BY created_at) AS next_is_correct,
            LEAD(created_at) OVER (PARTITION BY user_id, question_id ORDER BY created_at) AS next_created_at
          FROM public.question_review_attempts
        )
        SELECT
          COUNT(*) FILTER (
            WHERE is_correct = FALSE
              AND next_created_at IS NOT NULL
              AND next_created_at <= created_at + INTERVAL '48 hours'
          )::int AS retry_base_count,
          COUNT(*) FILTER (
            WHERE is_correct = FALSE
              AND next_created_at IS NOT NULL
              AND next_created_at <= created_at + INTERVAL '48 hours'
              AND next_is_correct = FALSE
          )::int AS retry_wrong_count
        FROM ordered_attempts
      `);
    const questionSummaryResult = await client.query(`
        SELECT
          COUNT(*)::int AS total_questions,
          COUNT(*) FILTER (WHERE COALESCE(is_archived, FALSE) = FALSE)::int AS active_questions,
          COUNT(*) FILTER (
            WHERE COALESCE(is_archived, FALSE) = FALSE
              AND next_review_date IS NOT NULL
              AND next_review_date <= NOW()
          )::int AS overdue_backlog,
          COUNT(*) FILTER (
            WHERE COALESCE(is_archived, FALSE) = FALSE
              AND next_review_date IS NULL
          )::int AS active_missing_due_count
        FROM public.questions
      `);
    const subjectSummaryResult = await client.query(`
        SELECT
          COALESCE(NULLIF(TRIM(subject), ''), '未标记') AS subject,
          COUNT(*) FILTER (
            WHERE COALESCE(is_archived, FALSE) = FALSE
              AND next_review_date IS NOT NULL
              AND next_review_date <= NOW()
          )::int AS overdue_count
        FROM public.questions
        GROUP BY 1
        ORDER BY overdue_count DESC, subject ASC
      `);

    const attemptSummary = attemptSummaryResult.rows[0] || {};
    const retrySummary = retrySummaryResult.rows[0] || {};
    const questionSummary = questionSummaryResult.rows[0] || {};

    const attempts7d = toNumber(attemptSummary.attempts_7d) || 0;
    const correctAttempts7d = toNumber(attemptSummary.correct_attempts_7d) || 0;
    const retryBaseCount = toNumber(retrySummary.retry_base_count) || 0;
    const retryWrongCount = toNumber(retrySummary.retry_wrong_count) || 0;
    const overdueBySubject = subjectSummaryResult.rows
      .filter((row) => Number(row.overdue_count || 0) > 0)
      .map((row) => `${row.subject}=${row.overdue_count}`)
      .join('，');

    const accuracy7d = attempts7d > 0 ? correctAttempts7d / attempts7d : null;
    const retryWrongRate48h = retryBaseCount > 0 ? retryWrongCount / retryBaseCount : null;

    const riskNotes = [];
    if (attempts7d === 0) {
      riskNotes.push('近 7 天暂无复习尝试样本，7 日正确率仅能反映空基线。');
    } else if (attempts7d < 20) {
      riskNotes.push(`近 7 天仅有 ${attempts7d} 次复习尝试，当前结果更适合本地验收，不代表稳定线上基线。`);
    }
    if (retryBaseCount === 0) {
      riskNotes.push('当前未观测到可用于计算 48 小时再错率的连续复习样本。');
    }
    if ((toNumber(questionSummary.total_questions) || 0) < 30) {
      riskNotes.push(`当前题库样本量仅 ${questionSummary.total_questions || 0} 题，适合验证链路，不适合做长期效果判断。`);
    }
    if ((toNumber(questionSummary.active_missing_due_count) || 0) > 0) {
      riskNotes.push(`active 题中仍有 ${questionSummary.active_missing_due_count} 条缺少 next_review_date，需先修复 due 口径再放大解读。`);
    }

    const markdown = `# Phase 0 复习基线报告

## 报表信息
- 生成时间：\`${generatedAt}\`
- 数据源：\`local-api\` 本地数据库
- 数据库连接：\`${databaseUrl.replace(/:[^:@/]+@/, ':****@')}\`
- 事实表：\`public.question_review_attempts\`、\`public.questions\`

## 基线总览
| 指标 | 值 |
| --- | --- |
| 7 日复习尝试数 | ${attempts7d} |
| 7 日覆盖题目数 | ${attemptSummary.questions_7d || 0} |
| 7 日正确率 | ${formatPercent(accuracy7d)} |
| 48h 再错样本数 | ${retryBaseCount} |
| 48h 再错率 | ${formatPercent(retryWrongRate48h)} |
| 题目总量 | ${questionSummary.total_questions || 0} |
| active 题量 | ${questionSummary.active_questions || 0} |
| overdue backlog | ${questionSummary.overdue_backlog || 0} |
| active 缺 due 数 | ${questionSummary.active_missing_due_count || 0} |

## 指标说明
- 7 日正确率：近 7 天 \`question_review_attempts\` 中 \`is_correct=true\` 的占比。
- 48h 再错率：同一用户同一题目一次错误后，48 小时内下一次复习仍错误的占比。
- overdue backlog：当前未归档且 \`next_review_date <= NOW()\` 的题目数。
- active 缺 due 数：当前未归档且 \`next_review_date IS NULL\` 的题目数。

## 结构摘要
- overdue 学科分布：${overdueBySubject || '—'}

## 风险提示
${riskNotes.length ? riskNotes.map((item) => `- ${item}`).join('\n') : '- 当前样本可作为 Phase 0 基线使用。'}

## 结论
- 当前基线报表已覆盖 Phase 0 要求的 7 日正确率、48h 再错率、overdue backlog 与 active 缺 due 数。
- 后续扩大灰度时，可重复执行 \`npm run report:review-ai:baseline\` 作为放量前后的对照基线。
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
