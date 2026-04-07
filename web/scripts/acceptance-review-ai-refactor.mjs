import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const docsRoot = path.resolve(root, '..', 'docs', 'review-ai-refactor');
const webEnvExamplePath = path.join(root, '.env.example');
const localApiEnvExamplePath = path.join(root, 'local-api', '.env.example');
const inputSchemaPath = path.join(docsRoot, 'ai-planner-input.schema.json');
const outputSchemaPath = path.join(docsRoot, 'ai-planner-output.schema.json');
const baselineFixSqlPath = path.join(docsRoot, 'phase0-baseline-fix.sql');
const baselineTemplatePath = path.join(docsRoot, 'phase0-baseline-report-template.md');
const grayFlagsDocPath = path.join(docsRoot, 'gray-release-flags.md');
const packageJsonPath = path.join(root, 'package.json');
const baselineReportScriptPath = path.join(root, 'scripts', 'report-review-ai-baseline.mjs');
const liveDrillScriptPath = path.join(root, 'scripts', 'run-review-ai-live-drill.mjs');
const liveAlertReportScriptPath = path.join(root, 'scripts', 'report-review-ai-live-alerts.mjs');
const offlineReportScriptPath = path.join(root, 'scripts', 'report-review-ai-offline-comparison.mjs');
const liveExecutionReportScriptPath = path.join(root, 'scripts', 'report-review-ai-live-execution.mjs');
const liveRunbookPath = path.join(docsRoot, 'phase3-live-runbook.md');
const configPath = path.join(root, 'src', 'app', 'lib', 'config.ts');
const typesPath = path.join(root, 'src', 'app', 'lib', 'types.ts');
const apiPath = path.join(root, 'src', 'app', 'lib', 'api.ts');
const reviewPlannerStrategyPath = path.join(root, 'src', 'app', 'lib', 'reviewPlannerStrategy.ts');
const reviewModePagePath = path.join(root, 'src', 'app', 'pages', 'ReviewModePage.tsx');

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function readEnvExample(filePath) {
  return readFileSync(filePath, 'utf-8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .reduce((acc, line) => {
      const idx = line.indexOf('=');
      if (idx <= 0) return acc;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      acc[key] = value;
      return acc;
    }, {});
}

function assertBooleanLike(env, key) {
  assert.ok(key in env, `缺少环境变量示例：${key}`);
  assert.match(env[key], /^(true|false|1|0|yes|no|on|off)$/i, `${key} 必须是布尔型字符串`);
}

function assertNumberRange(env, key, min, max) {
  assert.ok(key in env, `缺少环境变量示例：${key}`);
  const value = Number(env[key]);
  assert.ok(Number.isFinite(value), `${key} 必须是数值`);
  assert.ok(value >= min && value <= max, `${key} 必须在 ${min}~${max} 范围内`);
}

const inputSchema = readJson(inputSchemaPath);
const outputSchema = readJson(outputSchemaPath);
const webEnv = readEnvExample(webEnvExamplePath);
const localApiEnv = readEnvExample(localApiEnvExamplePath);
const packageJson = readJson(packageJsonPath);
const configSource = readFileSync(configPath, 'utf-8');
const typesSource = readFileSync(typesPath, 'utf-8');
const apiSource = readFileSync(apiPath, 'utf-8');
const baselineFixSql = readFileSync(baselineFixSqlPath, 'utf-8');
const baselineTemplateSource = readFileSync(baselineTemplatePath, 'utf-8');
const grayFlagsDocSource = readFileSync(grayFlagsDocPath, 'utf-8');
const baselineReportSource = readFileSync(baselineReportScriptPath, 'utf-8');
const liveDrillSource = readFileSync(liveDrillScriptPath, 'utf-8');
const liveAlertReportSource = readFileSync(liveAlertReportScriptPath, 'utf-8');
const offlineReportSource = readFileSync(offlineReportScriptPath, 'utf-8');
const liveExecutionReportSource = readFileSync(liveExecutionReportScriptPath, 'utf-8');
const liveRunbookSource = readFileSync(liveRunbookPath, 'utf-8');
const reviewPlannerStrategySource = readFileSync(reviewPlannerStrategyPath, 'utf-8');
const reviewModePageSource = readFileSync(reviewModePagePath, 'utf-8');

assert.equal(inputSchema.type, 'object', '输入 schema 顶层必须是 object');
assert.deepEqual(
  inputSchema.required,
  ['request_id', 'user', 'session_constraints', 'system_constraints', 'questions'],
  '输入 schema 顶层 required 字段不符合 v1 协议'
);
assert.equal(inputSchema.properties.system_constraints.properties.due_min_ratio.minimum, 0, '输入 schema 的 due_min_ratio 最小值必须为 0');
assert.equal(inputSchema.properties.system_constraints.properties.due_min_ratio.maximum, 1, '输入 schema 的 due_min_ratio 最大值必须为 1');
assert.ok(inputSchema.$defs.questionItem.required.includes('last_interval_days'), '输入 schema 缺少 last_interval_days');
assert.ok(inputSchema.$defs.questionItem.required.includes('predicted_recall'), '输入 schema 缺少 predicted_recall');

assert.equal(outputSchema.type, 'object', '输出 schema 顶层必须是 object');
assert.deepEqual(
  outputSchema.required,
  ['request_id', 'plan_version', 'queue', 'mix', 'risk', 'confidence'],
  '输出 schema 顶层 required 字段不符合 v1 协议'
);
assert.ok(outputSchema.$defs.queueItem.required.includes('priority_score'), '输出 schema 缺少 priority_score');
assert.equal(outputSchema.properties.confidence.minimum, 0, '输出 schema 的 confidence 最小值必须为 0');
assert.equal(outputSchema.properties.confidence.maximum, 1, '输出 schema 的 confidence 最大值必须为 1');
assert.match(typesSource, /stability\?: number;/, 'Question 类型缺少 stability');
assert.match(typesSource, /difficulty\?: number;/, 'Question 类型缺少 difficulty');
assert.match(typesSource, /last_interval_days\?: number;/, 'Question 类型缺少 last_interval_days');
assert.match(typesSource, /lapse_count\?: number;/, 'Question 类型缺少 lapse_count');
assert.match(typesSource, /predicted_recall\?: number;/, 'Question 类型缺少 predicted_recall');
assert.match(apiSource, /stability: row\?\.stability == null \? undefined : Number\(row\.stability\),/, 'normalizeQuestionRow 未处理 stability');
assert.match(apiSource, /predicted_recall: row\?\.predicted_recall == null \? undefined : Number\(row\.predicted_recall\),/, 'normalizeQuestionRow 未处理 predicted_recall');

for (const key of [
  'VITE_REVIEW_AI_PLANNER_ENABLED',
  'VITE_REVIEW_AI_SHADOW_MODE',
  'VITE_REVIEW_AI_FALLBACK_ENABLED',
]) {
  assertBooleanLike(webEnv, key);
}
assertNumberRange(webEnv, 'VITE_REVIEW_AI_GRAY_PERCENT', 0, 100);
assertNumberRange(webEnv, 'VITE_REVIEW_AI_DUE_MIN_RATIO', 0, 1);

for (const key of [
  'REVIEW_AI_PLANNER_ENABLED',
  'REVIEW_AI_SHADOW_MODE',
  'REVIEW_AI_FALLBACK_ENABLED',
]) {
  assertBooleanLike(localApiEnv, key);
}
assertNumberRange(localApiEnv, 'REVIEW_AI_GRAY_PERCENT', 0, 100);
assertNumberRange(localApiEnv, 'REVIEW_AI_DUE_MIN_RATIO', 0, 1);

assert.match(configSource, /export const reviewAiGrayPercent = parseNumberFlag\(envReviewAiGrayPercent, 0, 0, 100\);/, '前端灰度比例解析范围与文档不一致');
assert.match(configSource, /export const reviewAiDueMinRatio = parseNumberFlag\(envReviewAiDueMinRatio, 0\.4, 0, 1\);/, '前端 due 覆盖比例解析范围与文档不一致');

assert.match(typesSource, /export interface PlannerInputPayload/, '类型定义缺少 PlannerInputPayload');
assert.match(typesSource, /export interface PlanTelemetry/, '类型定义缺少 PlanTelemetry');
assert.match(typesSource, /export interface ReviewPlannerRunResult/, '类型定义缺少 ReviewPlannerRunResult');
assert.match(apiSource, /runPlannerShadow:/, 'API 未封装 runPlannerShadow 方法');
assert.match(apiSource, /REVIEW_PLANNER_MAX_RETRIES = 2;/, 'planner 重试次数未限制为 2');
assert.match(apiSource, /const controller = new AbortController\(\);/, 'runPlannerShadow 缺少 AbortController');
assert.match(apiSource, /setTimeout\(\(\) => controller\.abort\(\), REVIEW_PLANNER_TIMEOUT_MS\)/, 'planner 超时阈值未统一使用常量');
assert.match(apiSource, /console\.warn\(`\[runPlannerShadow\] Attempt \$\{attempt \+ 1\} failed:/, 'runPlannerShadow 缺少失败警告日志');
assert.match(apiSource, /runReviewPlanner:/, 'API 未封装 runReviewPlanner 方法');
assert.match(apiSource, /persistPlannerTelemetry\(/, 'API 缺少 live planner telemetry 落库');
assert.match(apiSource, /resolveReviewPlannerRollout\(/, 'runReviewPlanner 未统一接入 rollout 判定');
assert.match(apiSource, /rollout_metadata:/, 'runReviewPlanner 未返回 rollout metadata');
assert.match(reviewPlannerStrategySource, /REVIEW_PLANNER_STRATEGY_REGISTRY/, '缺少共享策略模板注册表');
assert.match(reviewPlannerStrategySource, /weighting_profile/, '共享策略模板注册表缺少权重画像');
assert.match(reviewPlannerStrategySource, /formatReviewPlannerFallbackReason/, '缺少统一 fallback 文案工具');
assert.match(reviewModePageSource, /page_number: safePage/, '复习页未把页码传入统一规划入口');
assert.doesNotMatch(reviewModePageSource, /shouldUseReviewAiPlanner/, '复习页不应保留页面层灰度判定');

const serverSource = readFileSync(path.join(root, 'local-api', 'server.mjs'), 'utf-8');
assert.match(serverSource, /\/api\/review\/planner\/shadow/, 'local-api 未暴露 shadow planner 路由');
assert.match(serverSource, /\/api\/review\/planner\/live/, 'local-api 未暴露 live planner 路由');
assert.match(serverSource, /comparison_summary/, 'local-api telemetry 缺少 comparison_summary');
assert.match(serverSource, /normalizeStrategyMeta/, 'local-api 未统一消费策略元数据');
assert.match(serverSource, /rollout_metadata/, 'local-api 未写入 rollout metadata');
assert.equal(existsSync(baselineFixSqlPath), true, '缺少 Phase 0 基线修复 SQL');
assert.equal(existsSync(baselineTemplatePath), true, '缺少 Phase 0 基线模板文档');
assert.equal(existsSync(grayFlagsDocPath), true, '缺少灰度开关说明文档');
assert.match(baselineFixSql, /UPDATE public\.questions/, '基线修复 SQL 缺少 questions 更新逻辑');
assert.match(baselineFixSql, /mastery_state = 'active'/, '基线修复 SQL 未限定 active 题目');
assert.match(baselineFixSql, /next_review_date IS NULL/, '基线修复 SQL 未限定缺失 due 的题目');
assert.match(baselineTemplateSource, /48h 再错率/, 'Phase 0 基线模板缺少 48h 再错率');
assert.match(grayFlagsDocSource, /VITE_REVIEW_AI_GRAY_PERCENT/, '灰度开关文档缺少前端灰度比例说明');
assert.equal(existsSync(baselineReportScriptPath), true, '缺少 Phase 0 基线报表脚本');
assert.match(baselineReportSource, /question_review_attempts/, '基线报表脚本未读取复习尝试事实表');
assert.match(baselineReportSource, /48h 再错率/, '基线报表脚本未输出 48h 再错率');
assert.equal(existsSync(offlineReportScriptPath), true, '缺少离线收益对比报表脚本');
assert.match(offlineReportSource, /public\.review_plan_telemetry/, '离线报表脚本未读取 telemetry 表');
assert.match(offlineReportSource, /formatCounter\(reasonCounter, 10\)/, '离线报表脚本未输出推荐理由分布');
assert.equal(existsSync(liveDrillScriptPath), true, '缺少 AI live 演练脚本');
assert.match(liveDrillSource, /\/api\/review\/planner\/live/, 'AI live 演练脚本未调用 live planner');
assert.match(liveDrillSource, /planSource !== 'ai'/, 'AI live 演练脚本未校验 AI 样本');
assert.equal(existsSync(liveAlertReportScriptPath), true, '缺少 AI live 告警脚本');
assert.match(liveAlertReportSource, /planner_timeout/, 'AI live 告警脚本未统计 timeout');
assert.match(liveAlertReportSource, /schema_invalid/, 'AI live 告警脚本未统计 schema 异常');
assert.equal(existsSync(liveExecutionReportScriptPath), true, '缺少 AI live 执行日报脚本');
assert.match(liveExecutionReportSource, /plan_source/, 'AI live 执行日报未统计 plan_source');
assert.match(liveExecutionReportSource, /fallback_reason/, 'AI live 执行日报未统计 fallback_reason');
assert.match(liveExecutionReportSource, /rollout selected 分布/, 'AI live 执行日报未输出 rollout 维度摘要');
assert.match(liveExecutionReportSource, /plan_version 分布/, 'AI live 执行日报未输出 plan_version 分布');
assert.match(baselineReportSource, /overdue backlog/, '基线报表脚本未输出 overdue backlog');
assert.equal(existsSync(liveRunbookPath), true, '缺少 Phase 3 回溯手册');
assert.match(liveRunbookSource, /plan_version/, 'Phase 3 回溯手册未说明 plan_version');
assert.match(liveRunbookSource, /fallback_reason/, 'Phase 3 回溯手册未说明 fallback_reason');
assert.equal(packageJson.scripts['drill:review-ai:live'], 'node scripts/run-review-ai-live-drill.mjs --write', 'package.json 缺少 AI live 演练命令');
assert.equal(packageJson.scripts['report:review-ai:baseline'], 'node scripts/report-review-ai-baseline.mjs --write', 'package.json 缺少 Phase 0 基线报表命令');
assert.equal(packageJson.scripts['report:review-ai:live-alerts'], 'node scripts/report-review-ai-live-alerts.mjs --write', 'package.json 缺少 AI live 告警命令');
assert.equal(packageJson.scripts['report:review-ai:offline-comparison'], 'node scripts/report-review-ai-offline-comparison.mjs --write', 'package.json 缺少离线报表命令');
assert.equal(packageJson.scripts['report:review-ai:live-execution'], 'node scripts/report-review-ai-live-execution.mjs --write', 'package.json 缺少 AI live 执行日报命令');
assert.match(readFileSync(path.join(root, 'scripts', 'report-review-ai-data-quality.mjs'), 'utf-8'), /priority_reference_now/, '数据质量报表未冻结 priority_score 参考时间');
assert.match(readFileSync(path.join(root, 'scripts', 'report-review-ai-data-quality.mjs'), 'utf-8'), /容差 1\.5/, '数据质量报表未说明 priority_score 容差口径');

process.stdout.write('Review AI refactor acceptance checks passed.\n');
