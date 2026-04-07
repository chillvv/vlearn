import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';

const root = path.resolve(process.cwd());
const copilotPath = path.join(root, 'src', 'app', 'lib', 'copilot.ts');
const copilotModePath = path.join(root, 'src', 'app', 'lib', 'copilotMode.ts');
const questionBankPath = path.join(root, 'src', 'app', 'pages', 'QuestionBankPage.tsx');
const questionCardPath = path.join(root, 'src', 'app', 'components', 'business', 'QuestionCard.tsx');
const nodeHubPath = path.join(root, 'src', 'app', 'pages', 'MistakeNodeHubPage.tsx');

const copilotSource = readFileSync(copilotPath, 'utf-8');
const copilotModeSource = readFileSync(copilotModePath, 'utf-8');
const questionBankSource = readFileSync(questionBankPath, 'utf-8');
const questionCardSource = readFileSync(questionCardPath, 'utf-8');
const nodeHubSource = readFileSync(nodeHubPath, 'utf-8');

assert.match(copilotSource, /export const WRITE_COPILOT_ACTIONS:/, '缺少写动作类型拆分');
assert.match(copilotSource, /export function requiresCopilotPreview\(/, '缺少高风险动作三段式判断');
assert.match(copilotSource, /export function validateCopilotActionRequest\(/, '缺少结构化动作请求校验');
assert.match(copilotSource, /export function getCopilotRefreshHints\(/, '缺少写后刷新提示规则');

assert.match(copilotModeSource, /getMiniCopilotModeSwitchRules/, '缺少四种能力切换规则');
assert.match(copilotModeSource, /getMiniCopilotBoundaryHint/, '缺少小管家职责边界提示');
assert.match(copilotModeSource, /录入整理/, '缺少统一前台能力：录入整理');
assert.match(copilotModeSource, /讲解追问/, '缺少统一前台能力：讲解追问');
assert.match(copilotModeSource, /计划推荐/, '缺少统一前台能力：计划推荐');
assert.match(copilotModeSource, /跳转启动/, '缺少统一前台能力：跳转启动');

assert.match(questionCardSource, /问这题/, '题目卡片缺少“问这题”入口');
assert.match(questionBankSource, /整理这个知识点/, '题库页缺少“整理这个知识点”入口');
assert.match(questionBankSource, /比较这几题/, '题库页缺少“比较这几题”入口');
assert.match(questionBankSource, /openNodeHub = \(question: Question/, '题库页缺少统一节点入口跳转');

assert.match(nodeHubSource, /tag_id：/, '知识点页缺少 tag_id 展示');
assert.match(nodeHubSource, /node_id：/, '知识点页缺少 node_id 展示');
assert.match(nodeHubSource, /mistake_id：/, '知识点页缺少 mistake_id 展示');
assert.match(nodeHubSource, /当前能力：/, '知识点页缺少当前能力展示');
assert.match(nodeHubSource, /内部工作态：/, '知识点页缺少内部工作态回显');
assert.match(nodeHubSource, /CAPABILITY_ORDER\.map/, '知识点页缺少统一能力切换入口');
assert.match(nodeHubSource, /handleCapabilitySelect/, '知识点页缺少统一能力切换逻辑');
assert.match(nodeHubSource, /自动识别/, '知识点页缺少自动识别切换入口');
assert.match(nodeHubSource, /modeSwitchRules\.map/, '知识点页缺少工作态切换条件说明');
assert.match(nodeHubSource, /miniCopilotBoundaryHint/, '知识点页缺少职责边界提示');
assert.match(nodeHubSource, /mergeFollowUpUpdates/, '执行回执缺少统一刷新提示合并');

process.stdout.write('Question bank mini copilot acceptance checks passed.\n');
