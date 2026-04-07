import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envFilePath = path.join(__dirname, '.env');
const migrationName = process.argv[2] || '';

if (!migrationName) {
  throw new Error('缺少 migration 文件名参数');
}

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

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationPath = path.join(repoRoot, 'supabase', 'migrations', migrationName);
const sql = readFileSync(migrationPath, 'utf-8');
const pool = new Pool({ connectionString: databaseUrl });

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(sql);
  await client.query(
    'INSERT INTO public.local_migration_history (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
    [migrationName],
  );
  await client.query('COMMIT');
  process.stdout.write(`applied: ${migrationName}\n`);
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
