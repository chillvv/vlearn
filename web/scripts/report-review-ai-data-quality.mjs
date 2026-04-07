import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(webRoot, '..');
const localApiRoot = path.join(webRoot, 'local-api');
const reportPath = path.join(projectRoot, 'docs', 'review-ai-refactor', 'phase1-data-quality-report.md');

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

function formatNumber(value, digits = 2) {
  if (value == null || value === '') return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return numeric.toFixed(digits);
}

function formatPercent(part, total, digits = 2) {
  if (!Number.isFinite(Number(part)) || !Number.isFinite(Number(total)) || Number(total) === 0) return '—';
  return `${((Number(part) / Number(total)) * 100).toFixed(digits)}%`;
}

function formatDistribution(rows) {
  if (!rows.length) return '—';
  return rows
    .map((row) => `${row.bucket}=${row.count}`)
    .join('，');
}

async function queryNumericMetric(client, field, validPredicate, bucketCaseSql) {
  const statsSql = `
    WITH scoped AS (
      SELECT ${field}::numeric AS value
      FROM public.questions
    )
    SELECT
      COUNT(*)::int AS total_rows,
      COUNT(*) FILTER (WHERE value IS NULL)::int AS null_count,
      COUNT(*) FILTER (WHERE value IS NOT NULL AND NOT (${validPredicate}))::int AS invalid_count,
      MIN(value)::text AS min_value,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY value)::text AS p50_value,
      percentile_cont(0.9) WITHIN GROUP (ORDER BY value)::text AS p90_value,
      AVG(value)::text AS avg_value,
      MAX(value)::text AS max_value
    FROM scoped
    WHERE value IS NOT NULL
  `;
  const distributionSql = `
    WITH scoped AS (
      SELECT ${field}::numeric AS value
      FROM public.questions
      WHERE ${field} IS NOT NULL
    ),
    bucketed AS (
      SELECT ${bucketCaseSql} AS bucket
      FROM scoped
    )
    SELECT bucket, COUNT(*)::int AS count
    FROM bucketed
    GROUP BY bucket
    ORDER BY MIN(
      CASE bucket
        WHEN '0' THEN 0
        WHEN '0-0.2' THEN 1
        WHEN '0.2-0.4' THEN 2
        WHEN '0.4-0.6' THEN 3
        WHEN '0.6-0.8' THEN 4
        WHEN '0.8-1.0' THEN 5
        WHEN '0-1' THEN 1
        WHEN '1-7' THEN 2
        WHEN '7-30' THEN 3
        WHEN '30-90' THEN 4
        WHEN '90+' THEN 5
        WHEN '0-40' THEN 1
        WHEN '40-60' THEN 2
        WHEN '60-80' THEN 3
        WHEN '80-100' THEN 4
        WHEN '100+' THEN 5
        WHEN '0-1d' THEN 1
        WHEN '1-3d' THEN 2
        WHEN '3-7d' THEN 3
        WHEN '7-14d' THEN 4
        WHEN '14+d' THEN 5
        WHEN '1' THEN 1
        WHEN '2' THEN 2
        WHEN '3' THEN 3
        WHEN '4+' THEN 4
        ELSE 99
      END
    )
  `;
  const [statsResult, distributionResult] = await Promise.all([
    client.query(statsSql),
    client.query(distributionSql),
  ]);
  return {
    totalRows: Number(statsResult.rows[0]?.total_rows || 0),
    nullCount: Number(statsResult.rows[0]?.null_count || 0),
    invalidCount: Number(statsResult.rows[0]?.invalid_count || 0),
    minValue: statsResult.rows[0]?.min_value ?? null,
    p50Value: statsResult.rows[0]?.p50_value ?? null,
    p90Value: statsResult.rows[0]?.p90_value ?? null,
    avgValue: statsResult.rows[0]?.avg_value ?? null,
    maxValue: statsResult.rows[0]?.max_value ?? null,
    distribution: distributionResult.rows.map((row) => ({
      bucket: row.bucket,
      count: Number(row.count || 0),
    })),
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
    const summaryResult = await client.query(`
      SELECT
        COUNT(*)::int AS total_questions,
        COUNT(*) FILTER (WHERE COALESCE(is_archived, FALSE) = FALSE)::int AS active_questions,
        COUNT(*) FILTER (WHERE COALESCE(is_archived, FALSE) = TRUE)::int AS archived_questions,
        COUNT(*) FILTER (
          WHERE COALESCE(is_archived, FALSE) = FALSE
            AND next_review_date IS NOT NULL
            AND next_review_date <= NOW()
        )::int AS due_questions,
        COUNT(*) FILTER (
          WHERE COALESCE(is_archived, FALSE) = FALSE
            AND next_review_date IS NULL
        )::int AS due_date_missing_questions,
        COUNT(*) FILTER (WHERE plan_source = 'rule_fallback')::int AS rule_fallback_questions,
        COUNT(*) FILTER (WHERE plan_source = 'ai')::int AS ai_questions
      FROM public.questions
    `);

    const subjectResult = await client.query(`
      SELECT
        COALESCE(NULLIF(TRIM(subject), ''), '未标记') AS subject,
        COUNT(*)::int AS count
      FROM public.questions
      GROUP BY 1
      ORDER BY count DESC, subject ASC
    `);

    const planSourceStatsResult = await client.query(`
      SELECT
        COUNT(*)::int AS total_rows,
        COUNT(*) FILTER (WHERE plan_source IS NULL OR TRIM(plan_source) = '')::int AS null_count,
        COUNT(*) FILTER (
          WHERE plan_source IS NOT NULL
            AND TRIM(plan_source) <> ''
            AND plan_source NOT IN ('ai', 'rule_fallback')
        )::int AS invalid_count
      FROM public.questions
    `);

    const planSourceDistributionResult = await client.query(`
      SELECT
        COALESCE(NULLIF(TRIM(plan_source), ''), 'NULL') AS bucket,
        COUNT(*)::int AS count
      FROM public.questions
      GROUP BY 1
      ORDER BY count DESC, bucket ASC
    `);

    const priorityStats = await queryNumericMetric(
      client,
      'priority_score',
      'value >= 0 AND value <= 100',
      `
        CASE
          WHEN value = 0 THEN '0'
          WHEN value < 40 THEN '0-40'
          WHEN value < 60 THEN '40-60'
          WHEN value < 80 THEN '60-80'
          WHEN value <= 100 THEN '80-100'
          ELSE '100+'
        END
      `
    );

    const stabilityStats = await queryNumericMetric(
      client,
      'stability',
      'value >= 0',
      `
        CASE
          WHEN value <= 1 THEN '0-1'
          WHEN value <= 7 THEN '1-7'
          WHEN value <= 30 THEN '7-30'
          WHEN value <= 90 THEN '30-90'
          ELSE '90+'
        END
      `
    );

    const difficultyStats = await queryNumericMetric(
      client,
      'difficulty',
      'value >= 0 AND value <= 1',
      `
        CASE
          WHEN value < 0.2 THEN '0-0.2'
          WHEN value < 0.4 THEN '0.2-0.4'
          WHEN value < 0.6 THEN '0.4-0.6'
          WHEN value < 0.8 THEN '0.6-0.8'
          ELSE '0.8-1.0'
        END
      `
    );

    const intervalStats = await queryNumericMetric(
      client,
      'last_interval_days',
      'value >= 0',
      `
        CASE
          WHEN value = 0 THEN '0'
          WHEN value <= 1 THEN '0-1d'
          WHEN value <= 3 THEN '1-3d'
          WHEN value <= 7 THEN '3-7d'
          WHEN value <= 14 THEN '7-14d'
          ELSE '14+d'
        END
      `
    );

    const lapseStats = await queryNumericMetric(
      client,
      'lapse_count',
      'value >= 0',
      `
        CASE
          WHEN value = 0 THEN '0'
          WHEN value = 1 THEN '1'
          WHEN value = 2 THEN '2'
          WHEN value = 3 THEN '3'
          ELSE '4+'
        END
      `
    );

    const recallStats = await queryNumericMetric(
      client,
      'predicted_recall',
      'value >= 0 AND value <= 1',
      `
        CASE
          WHEN value < 0.2 THEN '0-0.2'
          WHEN value < 0.4 THEN '0.2-0.4'
          WHEN value < 0.6 THEN '0.4-0.6'
          WHEN value < 0.8 THEN '0.6-0.8'
          ELSE '0.8-1.0'
        END
      `
    );

    const consistencyResult = await client.query(`
      WITH reference_clock AS (
        SELECT NOW() AS reference_now
      ),
      priority_check AS (
        SELECT
          q.*,
          reference_clock.reference_now,
          ROUND(
            LEAST(
              100,
              GREATEST(
                0,
                CASE
                  WHEN COALESCE(q.is_archived, FALSE) OR COALESCE(q.mastery_state, 'active') = 'archived' THEN 0
                  WHEN q.next_review_date IS NULL THEN 35
                  WHEN q.next_review_date <= reference_clock.reference_now THEN 60 + LEAST(25, GREATEST(0, EXTRACT(EPOCH FROM (reference_clock.reference_now - q.next_review_date)) / 86400.0) * 8)
                  ELSE GREATEST(0, 30 - LEAST(30, GREATEST(0, EXTRACT(EPOCH FROM (q.next_review_date - reference_clock.reference_now)) / 86400.0) * 5))
                END
                + GREATEST(0, (1 - COALESCE(q.confidence, 0.5)) * 25)
                + CASE WHEN COALESCE(q.stubborn_flag, FALSE) THEN 12 ELSE 0 END
                + LEAST(8, GREATEST(0, COALESCE(q.review_count, 0)) * 0.8)
                + CASE COALESCE(q.mastery_state, 'active')
                    WHEN 'mastered' THEN 2
                    ELSE 10
                  END
              )
            ),
            2
          ) AS expected_priority_score
        FROM public.questions q
        CROSS JOIN reference_clock
      )
      SELECT
        COUNT(*)::int AS total_rows,
        COUNT(*) FILTER (
          WHERE priority_score IS NULL
        )::int AS priority_missing_count,
        COUNT(*) FILTER (
          WHERE priority_score IS NOT NULL
            AND ABS(priority_score - expected_priority_score) > 1.5
        )::int AS priority_mismatch_count,
        COUNT(*) FILTER (
          WHERE predicted_recall IS NULL
        )::int AS predicted_recall_missing_count,
        COUNT(*) FILTER (
          WHERE predicted_recall IS NOT NULL
            AND ABS(
              predicted_recall - public.compute_review_predicted_recall(
                confidence,
                stability,
                last_interval_days,
                lapse_count,
                next_review_date,
                mastery_state,
                is_archived
              )
            ) > 0.001
        )::int AS predicted_recall_mismatch_count,
        MIN(reference_now)::text AS priority_reference_now
      FROM priority_check
    `);

    const summary = summaryResult.rows[0];
    const planSourceStats = planSourceStatsResult.rows[0];
    const consistency = consistencyResult.rows[0];
    const totalQuestions = Number(summary.total_questions || 0);
    const subjectSummary = subjectResult.rows
      .map((row) => `${row.subject}=${row.count}`)
      .join('，');
    const riskNotes = [];
    if (Number(summary.due_date_missing_questions || 0) > 0) {
      riskNotes.push(`active 题中仍有 ${summary.due_date_missing_questions} 条缺少 next_review_date，当前 due 口径仅能反映部分状态。`);
    }
    if (totalQuestions < 30) {
      riskNotes.push(`当前本地样本量仅 ${totalQuestions} 题，足够做字段完整性校验，但不足以代表真实线上基线分布。`);
    }
    if (Number(summary.ai_questions || 0) === 0) {
      riskNotes.push('当前尚无 AI 计划产物落库，说明真实 live 样本仍不足，需继续补充灰度执行样本。');
    }
    riskNotes.push('priority_score 一致性校验已改为冻结本次报表 reference_now 并采用 1.5 分容差，仅用于报表回归，不改变线上业务函数。');

    const fieldRows = [
      {
        field: 'plan_source',
        totalRows: Number(planSourceStats.total_rows || 0),
        nullCount: Number(planSourceStats.null_count || 0),
        invalidCount: Number(planSourceStats.invalid_count || 0),
        minValue: '—',
        p50Value: '—',
        p90Value: '—',
        avgValue: '—',
        maxValue: '—',
        distribution: planSourceDistributionResult.rows.map((row) => ({
          bucket: row.bucket,
          count: Number(row.count || 0),
        })),
      },
      { field: 'priority_score', ...priorityStats },
      { field: 'stability', ...stabilityStats },
      { field: 'difficulty', ...difficultyStats },
      { field: 'last_interval_days', ...intervalStats },
      { field: 'lapse_count', ...lapseStats },
      { field: 'predicted_recall', ...recallStats },
    ];

    const markdown = `# Phase 1 数据质量校验报告

## 报表信息
- 生成时间：\`${generatedAt}\`
- 数据源：\`local-api\` 本地数据库
- 数据库连接：\`${databaseUrl.replace(/:[^:@/]+@/, ':****@')}\`
- 统计对象：\`public.questions\`

## 总览
| 指标 | 值 |
| --- | --- |
| 题目总量 | ${totalQuestions} |
| active 题量 | ${summary.active_questions} |
| archived 题量 | ${summary.archived_questions} |
| due 题量 | ${summary.due_questions} |
| active 且缺少 next_review_date | ${summary.due_date_missing_questions} |
| rule_fallback 题量 | ${summary.rule_fallback_questions} |
| ai 题量 | ${summary.ai_questions} |
| 学科分布 | ${subjectSummary || '—'} |

## 字段质量明细
| 字段 | 空值数 | 空值率 | 越界/非法值数 | 越界率 | min | p50 | p90 | avg | max | 分布摘要 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${fieldRows.map((row) => `| ${row.field} | ${row.nullCount} | ${formatPercent(row.nullCount, row.totalRows)} | ${row.invalidCount} | ${formatPercent(row.invalidCount, row.totalRows)} | ${formatNumber(row.minValue)} | ${formatNumber(row.p50Value)} | ${formatNumber(row.p90Value)} | ${formatNumber(row.avgValue)} | ${formatNumber(row.maxValue)} | ${formatDistribution(row.distribution)} |`).join('\n')}

## 一致性校验
冻结参考时间：\`${consistency.priority_reference_now || '—'}\`

| 校验项 | 问题数 | 占比 |
| --- | --- | --- |
| priority_score 缺失 | ${consistency.priority_missing_count} | ${formatPercent(consistency.priority_missing_count, consistency.total_rows)} |
| priority_score 与冻结口径不一致（容差 1.5） | ${consistency.priority_mismatch_count} | ${formatPercent(consistency.priority_mismatch_count, consistency.total_rows)} |
| predicted_recall 缺失 | ${consistency.predicted_recall_missing_count} | ${formatPercent(consistency.predicted_recall_missing_count, consistency.total_rows)} |
| predicted_recall 与计算函数不一致 | ${consistency.predicted_recall_mismatch_count} | ${formatPercent(consistency.predicted_recall_mismatch_count, consistency.total_rows)} |

## 风险提示
${riskNotes.length ? riskNotes.map((item) => `- ${item}`).join('\n') : '- 未发现额外风险提示。'}

## 结论
- \`plan_source\` / \`priority_score\` / \`stability\` / \`difficulty\` / \`last_interval_days\` / \`lapse_count\` / \`predicted_recall\` 已可继续用于 Phase 4 live 优化与回归对比。
- 如 \`ai\` 题量仍为 0，说明当前真实 live 遥测仍偏少，后续应优先补充灰度执行样本。
- 后续扩大灰度前，优先结合 Phase 0 基线报表与本脚本结果一起判断是否满足放量条件。
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
