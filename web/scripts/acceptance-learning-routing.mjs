import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const docsRoot = path.resolve(root, '..', 'docs', 'review-ai-refactor');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf-8');
}

const learningSessionSource = read('src/app/lib/learningSession.ts');
const copilotDialogSource = read('src/app/components/business/CopilotHandoffDialog.tsx');
const draftReviewSource = read('src/app/pages/DraftReviewPage.tsx');
const nodeHubSource = read('src/app/pages/MistakeNodeHubPage.tsx');
const reviewModeSource = read('src/app/pages/ReviewModePage.tsx');
const targetedDrillSource = read('src/app/pages/TargetedDrillPage.tsx');
const activeLearningTaskSource = read('src/app/lib/activeLearningTask.ts');
const apiSource = read('src/app/lib/api.ts');
const rolloutDocPath = path.join(docsRoot, 'learning-routing-rollout.md');
const rolloutDocSource = readFileSync(rolloutDocPath, 'utf-8');

assert.match(learningSessionSource, /export const LEARNING_SESSION_READ_PRIORITY/, '缺少 proposal 读取优先级');
assert.match(learningSessionSource, /LEGACY_LEARNING_SESSION_QUERY_PARAM_MAP/, '缺少 legacy query 参数映射表');
assert.match(learningSessionSource, /createLearningSessionProposal/, '缺少统一 proposal 创建入口');
assert.match(learningSessionSource, /buildLearningSessionNavigation/, '缺少统一正式学习跳转构造');
assert.match(learningSessionSource, /return_path/, '统一 proposal 跳转未透传 return_path');
assert.match(learningSessionSource, /next_step_label/, '统一 proposal 跳转未透传 next step hint');
assert.match(learningSessionSource, /ignored-query-proposal/, '缺少 state 优先于 query 的冲突兜底');
assert.match(learningSessionSource, /legacy-scope-conflict/, '缺少旧复习范围冲突恢复');

assert.match(copilotDialogSource, /立即开始/, 'handoff card 缺少开始动作');
assert.match(copilotDialogSource, /调整范围/, 'handoff card 缺少调整范围动作');
assert.match(copilotDialogSource, /取消/, 'handoff card 缺少取消动作');
assert.match(copilotDialogSource, /expectedBenefit/, 'handoff card 缺少预期收益展示');

assert.match(draftReviewSource, /CopilotHandoffDialog/, '草稿页缺少 handoff card 挂载');
assert.match(draftReviewSource, /returnPath:\s*\{\s*pathname:\s*'\/draft-review'/, '草稿页缺少回到 AI 管家的 return path');
assert.match(draftReviewSource, /nextStepHint:/, '草稿页缺少 next step hint 透传');
assert.match(nodeHubSource, /CopilotHandoffDialog/, '节点页缺少 handoff card 挂载');
assert.match(nodeHubSource, /returnPath:\s*\{\s*pathname:\s*location\.pathname/, '节点页缺少回到节点 AI 的 return path');
assert.match(nodeHubSource, /当前能力：/, '节点页未切换到统一前台能力标签');
assert.match(nodeHubSource, /内部工作态：/, '节点页缺少内部工作态辅助回显');

assert.match(reviewModeSource, /writePersistedReviewTask/, '复习中心缺少进行中任务持久化');
assert.match(reviewModeSource, /readPersistedReviewTask/, '复习中心缺少进行中任务恢复');
assert.match(reviewModeSource, /clearPersistedReviewTask/, '复习中心缺少完成后清理');
assert.match(reviewModeSource, /startTargetedPractice/, '复习中心缺少转专项补弱动作');
assert.match(reviewModeSource, /去 AI 管家复盘/, '复习结果页缺少回 AI 管家入口');
assert.match(reviewModeSource, /goToReturnPath/, '复习中心缺少统一 return path 回流');

assert.match(targetedDrillSource, /writePersistedPracticeTask/, '专项练习缺少进行中任务持久化');
assert.match(targetedDrillSource, /readPersistedPracticeTask/, '专项练习缺少进行中任务恢复');
assert.match(targetedDrillSource, /clearPersistedPracticeTask/, '专项练习缺少完成后清理');
assert.match(targetedDrillSource, /generationFallbackNotice/, '专项练习缺少部分补题 fallback 提示');
assert.match(targetedDrillSource, /judgeFallbackNotice/, '专项练习缺少判题 fallback 提示');
assert.match(targetedDrillSource, /去复习/, '专项练习结果页缺少去复习 CTA');
assert.match(targetedDrillSource, /再练一轮/, '专项练习结果页缺少再练一轮 CTA');
assert.match(targetedDrillSource, /回 AI 管家继续追问/, '专项练习结果页缺少回 AI 管家 CTA');
assert.match(targetedDrillSource, /navigateToReturnPath/, '专项练习缺少统一 return path 回流');

assert.match(activeLearningTaskSource, /vlearn\.active-review-task\.v1/, '缺少 review 持久化 contract');
assert.match(activeLearningTaskSource, /vlearn\.active-practice-task\.v1/, '缺少 practice 持久化 contract');
assert.match(activeLearningTaskSource, /version:\s*'v1'/, '持久化 envelope 缺少版本字段');

assert.match(apiSource, /getWritebackLedgerKey/, '服务端侧写回缺少幂等 ledger');
assert.match(apiSource, /readWritebackLedger/, '服务端侧写回缺少幂等读取');
assert.match(apiSource, /writeWritebackLedger/, '服务端侧写回缺少幂等写入');
assert.match(apiSource, /question_generation_telemetry/, '服务端侧缺少出题 telemetry');
assert.match(apiSource, /learning_session_telemetry/, '服务端侧缺少学习会话 telemetry');
assert.match(apiSource, /fallback_reason/, '服务端侧 telemetry 缺少 fallback_reason');
assert.match(apiSource, /completion_outcome/, '服务端侧 telemetry 缺少 completion_outcome');
assert.match(apiSource, /录入整理只处理错题草稿、知识点整理与结构修订/, 'AI copilot prompt 未切换到统一前台能力');
assert.match(apiSource, /若当前能力不是跳转启动，禁止主动输出完整复习正文或完整专项练习正文/, 'AI copilot prompt 未收紧聊天区边界');
assert.doesNotMatch(apiSource, /录题模式优先处理错题草稿与知识点整理/, 'AI copilot prompt 仍保留旧模式文案');

assert.equal(existsSync(rolloutDocPath), true, '缺少学习编排灰度与回滚方案文档');
assert.match(rolloutDocSource, /learning_session_orchestrator/, '灰度文档缺少统一 proposal 开关');
assert.match(rolloutDocSource, /copilot_handoff_card/, '灰度文档缺少 handoff card 开关');
assert.match(rolloutDocSource, /practice 进入率/, '灰度文档缺少 practice 进入率');
assert.match(rolloutDocSource, /review 完成率/, '灰度文档缺少 review 完成率');
assert.match(rolloutDocSource, /practice→review 切换率/, '灰度文档缺少 practice→review 切换率');
assert.match(rolloutDocSource, /review→practice 切换率/, '灰度文档缺少 review→practice 切换率');
assert.match(rolloutDocSource, /fallback 率/, '灰度文档缺少 fallback 率');
assert.match(rolloutDocSource, /AI handoff 接受率/, '灰度文档缺少 AI handoff 接受率');
assert.match(rolloutDocSource, /删除用户可见的旧模式文案/, '灰度结束清理项缺少旧模式文案清理');

process.stdout.write('Learning routing acceptance checks passed.\n');
