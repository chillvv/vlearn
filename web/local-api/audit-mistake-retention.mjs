import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envFilePath = path.join(__dirname, '.env');

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
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

loadEnvFile(envFilePath);

const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!databaseUrl) {
  throw new Error('缺少 DATABASE_URL');
}

const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();

try {
  const tables = [
    'questions',
    'question_review_attempts',
    'review_plan_cache',
    'practice_attempts',
    'practice_sessions',
    'shared_questions',
    'user_weakness',
    'tag_mistake_sub_bank',
    'tag_knowledge_sub_bank',
  ];

  const counts = {};
  for (const table of tables) {
    const result = await client.query(`SELECT COUNT(*)::int AS total FROM public.${table}`);
    counts[table] = result.rows[0]?.total || 0;
  }

  const practiceAttemptSamples = await client.query(
    `SELECT id, question_text, knowledge_point, created_at
     FROM public.practice_attempts
     ORDER BY created_at DESC
     LIMIT 5`,
  );

  const shareSamples = await client.query(
    `SELECT code, jsonb_array_length(questions) AS payload_size, expires_at, created_at
     FROM public.shared_questions
     ORDER BY created_at DESC
     LIMIT 5`,
  );

  process.stdout.write(
    `${JSON.stringify({
      counts,
      practice_attempt_samples: practiceAttemptSamples.rows,
      shared_payload_samples: shareSamples.rows,
    }, null, 2)}\n`,
  );
} finally {
  client.release();
  await pool.end();
}
