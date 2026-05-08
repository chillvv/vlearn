import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';

const root = path.resolve(process.cwd());
const draftPagePath = path.join(root, 'src', 'app', 'pages', 'DraftReviewPage.tsx');
const tagPagePath = path.join(root, 'src', 'app', 'pages', 'MistakeBookPage.tsx');
const policyPath = path.join(root, 'src', 'app', 'lib', 'draftImportPolicy.ts');
const tagServicePath = path.join(root, 'src', 'app', 'lib', 'tagTreeService.ts');
const copilotPath = path.join(root, 'src', 'app', 'lib', 'copilot.ts');
const actionContractPath = path.join(root, 'src', 'app', 'lib', 'aiActionContract.ts');
const actionResolverPath = path.join(root, 'src', 'app', 'lib', 'draftActionResolver.ts');

const draftPage = readFileSync(draftPagePath, 'utf-8');
const tagPage = readFileSync(tagPagePath, 'utf-8');
const policySource = readFileSync(policyPath, 'utf-8');
const tagServiceSource = readFileSync(tagServicePath, 'utf-8');
const copilotSource = readFileSync(copilotPath, 'utf-8');
const actionContractSource = readFileSync(actionContractPath, 'utf-8');
const actionResolverSource = readFileSync(actionResolverPath, 'utf-8');

assert.match(policySource, /export function validateDraftsBeforeImportPolicy\(/, '缺少统一入库校验策略');
assert.match(policySource, /export function normalizeDraftForImportPolicy\(/, '缺少统一入库标准化策略');
assert.match(tagServiceSource, /export async function moveNodeTag\(/, '缺少标签跨分类移动服务');
assert.match(tagServiceSource, /export async function renameNodeTag\(/, '缺少标签重命名服务');
assert.match(tagServiceSource, /export async function syncDeleteNodeTag\(/, '缺少标签删除同步服务');
assert.match(tagServiceSource, /export async function syncDeleteCategory\(/, '缺少分类删除同步服务');
assert.match(tagServiceSource, /export async function syncRenameCategory\(/, '缺少分类重命名同步服务');
assert.match(draftPage, /validateDraftsBeforeImportPolicy\(/, 'DraftReviewPage 未接入统一入库校验策略');
assert.match(draftPage, /normalizeDraftForImportPolicy\(/, 'DraftReviewPage 未接入统一入库标准化策略');
assert.match(tagPage, /moveNodeTag\(/, 'MistakeBookPage 未接入标签移动服务');
assert.match(tagPage, /renameNodeTag\(/, 'MistakeBookPage 未接入标签重命名服务');
assert.match(tagPage, /syncDeleteNodeTag\(/, 'MistakeBookPage 未接入标签删除同步服务');
assert.match(tagPage, /syncDeleteCategory\(/, 'MistakeBookPage 未接入分类删除同步服务');
assert.match(tagPage, /syncRenameCategory\(/, 'MistakeBookPage 未接入分类重命名同步服务');
assert.match(actionContractSource, /export const CORE_INGEST_ACTIONS/, '缺少入库核心动作白名单');
assert.match(copilotSource, /isCoreIngestAction/, 'copilot 未使用统一动作判定');
assert.match(actionResolverSource, /export async function resolveQuestionIdFromActionPayload\(/, '缺少动作目标题目解析器');
assert.match(draftPage, /resolveQuestionIdFromActionPayload\(/, 'DraftReviewPage 未接入动作目标题目解析器');

process.stdout.write('Draft import and tag decouple guardrails passed.\n');
