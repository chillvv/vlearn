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

const pool = new Pool({ connectionString: String(process.env.DATABASE_URL || '').trim() });
const client = await pool.connect();
try {
  const summary = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM public.knowledge_points) AS knowledge_points,
      (SELECT COUNT(*)::int FROM public.tag_catalog) AS tag_catalog,
      (SELECT COUNT(*)::int FROM public.tag_dictionary_items) AS tag_dictionary_items,
      (SELECT COUNT(*)::int FROM public.questions) AS questions
  `);
  const sampleTags = await client.query(`
    SELECT tag_id, subject, tag_name, code
    FROM public.tag_catalog
    ORDER BY tag_id
    LIMIT 5
  `);
  process.stdout.write(`${JSON.stringify({ summary: summary.rows[0], sampleTags: sampleTags.rows }, null, 2)}\n`);
} finally {
  client.release();
  await pool.end();
}
