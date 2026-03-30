import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const databaseUrl = String(process.env.DATABASE_URL || '').trim();

if (!databaseUrl) {
  throw new Error('缺少 DATABASE_URL');
}

const pool = new Pool({ connectionString: databaseUrl });

async function ensureLocalExtensions() {
  await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
}

async function ensureLocalAuthUsersTable() {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS auth
  `);
  await pool.query(`
    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS uuid
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$
  `);
  await pool.query(`
    CREATE OR REPLACE FUNCTION auth.role()
    RETURNS text
    LANGUAGE sql
    STABLE
    AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated')
    $$
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    INSERT INTO auth.users (id, email)
    VALUES ('00000000-0000-0000-0000-000000000001', 'local-seed@local.dev')
    ON CONFLICT (id) DO NOTHING
  `);
}

async function ensureSupabaseCompatRoles() {
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
      END IF;
    END $$;
  `);
}

async function ensureSharedQuestionsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.shared_questions (
      code text PRIMARY KEY,
      user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
      questions jsonb NOT NULL DEFAULT '[]'::jsonb,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function ensureQuestionsCompatColumns() {
  await pool.query(`
    DO $$
    BEGIN
      IF to_regclass('public.questions') IS NOT NULL THEN
        ALTER TABLE public.questions
          ADD COLUMN IF NOT EXISTS category text,
          ADD COLUMN IF NOT EXISTS node text,
          ADD COLUMN IF NOT EXISTS next_review_date timestamptz,
          ADD COLUMN IF NOT EXISTS stubborn_flag boolean DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS question_type text,
          ADD COLUMN IF NOT EXISTS correct_answer text,
          ADD COLUMN IF NOT EXISTS raw_ai_response text,
          ADD COLUMN IF NOT EXISTS normalized_payload jsonb,
          ADD COLUMN IF NOT EXISTS payload_version text DEFAULT 'v1',
          ADD COLUMN IF NOT EXISTS validation_status text DEFAULT 'valid',
          ADD COLUMN IF NOT EXISTS render_mode text DEFAULT 'structured',
          ADD COLUMN IF NOT EXISTS mastery_state text DEFAULT 'active',
          ADD COLUMN IF NOT EXISTS mastered_at timestamptz,
          ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS archived_at timestamptz,
          ADD COLUMN IF NOT EXISTS summary text,
          ADD COLUMN IF NOT EXISTS confidence numeric,
          ADD COLUMN IF NOT EXISTS mastery_level integer,
          ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
        UPDATE public.questions
        SET is_archived = COALESCE(is_archived, FALSE)
        WHERE is_archived IS NULL;
        UPDATE public.questions
        SET mastery_state = COALESCE(mastery_state, 'active')
        WHERE mastery_state IS NULL;
        ALTER TABLE public.questions
          ALTER COLUMN is_archived SET DEFAULT FALSE,
          ALTER COLUMN is_archived SET NOT NULL,
          ALTER COLUMN mastery_state SET DEFAULT 'active',
          ALTER COLUMN mastery_state SET NOT NULL;
        ALTER TABLE public.questions
          DROP CONSTRAINT IF EXISTS questions_mastery_state_check;
        ALTER TABLE public.questions
          ADD CONSTRAINT questions_mastery_state_check
          CHECK (mastery_state IN ('active', 'mastered', 'archived'));
      END IF;
    END $$;
  `);
}

async function ensureHistoryTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.local_migration_history (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function listMigrationFiles() {
  const files = await fs.readdir(migrationsDir);
  const migrationWeight = (name) => (name.includes('mock_questions') ? 1 : 0);
  return files
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => {
      const weightDiff = migrationWeight(a) - migrationWeight(b);
      if (weightDiff !== 0) return weightDiff;
      return a.localeCompare(b);
    });
}

async function isApplied(name) {
  const result = await pool.query(
    'SELECT 1 FROM public.local_migration_history WHERE name = $1 LIMIT 1',
    [name],
  );
  return result.rowCount > 0;
}

async function markApplied(client, name) {
  await client.query(
    'INSERT INTO public.local_migration_history (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
    [name],
  );
}

async function markAppliedDirect(name) {
  await pool.query(
    'INSERT INTO public.local_migration_history (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
    [name],
  );
}

async function applyOne(name) {
  const fullPath = path.join(migrationsDir, name);
  const sql = await fs.readFile(fullPath, 'utf-8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await markApplied(client, name);
    await client.query('COMMIT');
    process.stdout.write(`applied: ${name}\n`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error(`migration failed: ${name}\n${String(error?.message || error)}`);
  } finally {
    client.release();
  }
}

async function main() {
  await ensureLocalExtensions();
  await ensureLocalAuthUsersTable();
  await ensureSupabaseCompatRoles();
  await ensureSharedQuestionsTable();
  await ensureHistoryTable();
  const files = await listMigrationFiles();
  for (const name of files) {
    await ensureQuestionsCompatColumns();
    const applied = await isApplied(name);
    if (applied) {
      process.stdout.write(`skip: ${name}\n`);
      continue;
    }
    if (name.includes('mock_questions')) {
      await markAppliedDirect(name);
      process.stdout.write(`skip legacy seed migration: ${name}\n`);
      continue;
    }
    await applyOne(name);
  }
  process.stdout.write('local database migrations completed\n');
}

main()
  .catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
