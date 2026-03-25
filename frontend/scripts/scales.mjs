import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

function run(cmd, args, cwd = root) {
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: true });
  if (res.error) {
    console.error(res.error);
    process.exit(1);
  }
  if (res.status !== 0) process.exit(res.status ?? 1);
}

function assertFileIncludes(relPath, needles) {
  const abs = path.join(root, relPath);
  const text = readFileSync(abs, 'utf8');
  const missing = needles.filter((n) => !text.includes(n));
  if (missing.length > 0) {
    console.error(`SCALES check failed: ${relPath} missing:\n- ${missing.join('\n- ')}`);
    process.exit(1);
  }
}

run('npm', ['run', 'typecheck']);
run('npm', ['run', 'build']);

assertFileIncludes('src/app/pages/MistakeBookPage.tsx', [
  "onClick={() => navigate('/practice'",
  '立即去清零',
]);

assertFileIncludes('src/app/pages/ReviewModePage.tsx', [
  'disabled={!canReveal}',
  '请先选择答案',
  '提交失败，请重试',
]);

assertFileIncludes('src/app/pages/TargetedDrillPage.tsx', [
  'inferChoiceAnswer',
  'effectiveCorrectAnswer',
]);

assertFileIncludes('src/app/pages/SettingsPage.tsx', [
  "importCode.trim().length !== 8",
  'disabled={importCode.trim().length !== 8',
]);

assertFileIncludes('src/app/lib/api.ts', [
  'createShareCode',
  "supabase.rpc('create_share_code'",
  "supabase.rpc('get_shared_questions'",
]);

console.log('SCALES: OK');
