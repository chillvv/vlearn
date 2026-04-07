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
  await client.query('BEGIN');
  await client.query('DELETE FROM public.question_review_attempts');
  await client.query('DELETE FROM public.review_plan_cache');
  await client.query('DELETE FROM public.practice_attempts');
  await client.query('DELETE FROM public.practice_sessions');
  await client.query('DELETE FROM public.user_weakness');
  await client.query('DELETE FROM public.shared_questions');
  await client.query('DELETE FROM public.questions');
  await client.query('DELETE FROM public.knowledge_points');
  await client.query('DELETE FROM public.user_learning_state');
  await client.query('DELETE FROM public.tag_mistake_sub_bank');
  await client.query('DELETE FROM public.tag_knowledge_sub_bank');
  await client.query('DELETE FROM public.tag_dictionary_items');
  await client.query('DELETE FROM public.tag_catalog');
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}

const tables = [
  'questions',
  'knowledge_points',
  'tag_catalog',
  'tag_dictionary_items',
  'tag_mistake_sub_bank',
  'tag_knowledge_sub_bank',
  'user_weakness',
  'user_learning_state',
  'practice_sessions',
  'practice_attempts',
  'question_review_attempts',
];

for (const table of tables) {
  const count = await pool.query(`SELECT COUNT(*)::int AS total FROM public.${table}`);
  process.stdout.write(`${table}: ${count.rows[0]?.total || 0}\n`);
}

await pool.end();
