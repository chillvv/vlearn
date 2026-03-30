import process from 'node:process';
import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';

const localDatabaseUrl = String(process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL || '').trim();
const supabaseUrl = String(process.env.SUPABASE_URL || '').trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const userId = String(process.env.MIGRATION_USER_ID || '').trim();
const mode = String(process.env.MIGRATION_MODE || 'merge').trim().toLowerCase() === 'replace' ? 'replace' : 'merge';
const dryRun = ['1', 'true', 'yes'].includes(String(process.env.MIGRATION_DRY_RUN || '').trim().toLowerCase());
const batchSize = Math.max(1, Number.parseInt(String(process.env.MIGRATION_BATCH_SIZE || '200'), 10) || 200);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (!localDatabaseUrl) fail('缺少 LOCAL_DATABASE_URL 或 DATABASE_URL');
if (!supabaseUrl) fail('缺少 SUPABASE_URL');
if (!serviceRoleKey) fail('缺少 SUPABASE_SERVICE_ROLE_KEY');
if (!userId) fail('缺少 MIGRATION_USER_ID');

const pool = new Pool({ connectionString: localDatabaseUrl });
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function sanitizeQuestionRow(row) {
  return {
    user_id: userId,
    subject: row.subject || '英语',
    question_text: row.question_text || '',
    category: row.category ?? null,
    node: row.node ?? null,
    image_url: row.image_url ?? null,
    knowledge_point: row.knowledge_point || '',
    ability: row.ability || '规则应用',
    error_type: row.error_type || row.knowledge_point || '未分类',
    question_type: row.question_type ?? null,
    correct_answer: row.correct_answer ?? null,
    note: row.note ?? null,
    summary: row.summary ?? null,
    confidence: toNumberOrNull(row.confidence),
    mastery_level: toNumberOrNull(row.mastery_level),
    next_review_date: row.next_review_date ?? null,
    stubborn_flag: Boolean(row.stubborn_flag),
    review_count: Number.isFinite(Number(row.review_count)) ? Number(row.review_count) : 0,
    raw_ai_response: row.raw_ai_response || row.question_text || '',
    normalized_payload: row.normalized_payload ?? null,
    payload_version: row.payload_version ?? null,
    validation_status: row.validation_status ?? null,
    render_mode: row.render_mode ?? null,
  };
}

async function loadLocalQuestions() {
  const result = await pool.query(
    `SELECT
      subject, question_text, category, node, image_url, knowledge_point, ability, error_type,
      question_type, correct_answer, note, summary, confidence, mastery_level, next_review_date, stubborn_flag, review_count,
      raw_ai_response, normalized_payload, payload_version, validation_status, render_mode
     FROM questions
     WHERE user_id = $1
     ORDER BY created_at ASC`,
    [userId],
  );
  return result.rows.map((row) => sanitizeQuestionRow(row));
}

async function deleteCloudQuestions() {
  const response = await supabase.from('questions').delete().eq('user_id', userId);
  if (response.error) {
    throw new Error(`清空云端失败: ${response.error.message}`);
  }
}

async function insertBatch(batch) {
  const response = await supabase.from('questions').insert(batch);
  if (!response.error) {
    return { imported: batch.length, failed: 0 };
  }
  let imported = 0;
  let failed = 0;
  for (const item of batch) {
    const single = await supabase.from('questions').insert(item);
    if (single.error) {
      failed += 1;
      continue;
    }
    imported += 1;
  }
  return { imported, failed };
}

async function run() {
  const payload = await loadLocalQuestions();
  process.stdout.write(`检测到本地题目 ${payload.length} 条（user_id=${userId}）\n`);

  if (dryRun) {
    process.stdout.write(`DRY RUN：未写入云端，模式=${mode}\n`);
    return;
  }

  if (mode === 'replace') {
    await deleteCloudQuestions();
    process.stdout.write('已清空云端当前用户题目\n');
  }

  let imported = 0;
  let failed = 0;
  for (let i = 0; i < payload.length; i += batchSize) {
    const chunk = payload.slice(i, i + batchSize);
    const result = await insertBatch(chunk);
    imported += result.imported;
    failed += result.failed;
    process.stdout.write(`已处理 ${Math.min(i + chunk.length, payload.length)}/${payload.length}\n`);
  }

  process.stdout.write(`迁移完成：成功 ${imported} 条，失败 ${failed} 条，模式=${mode}\n`);
}

run()
  .catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
