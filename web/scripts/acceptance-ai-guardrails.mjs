import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';

const root = path.resolve(process.cwd());
const apiPath = path.join(root, 'src', 'app', 'lib', 'api.ts');
const copilotPath = path.join(root, 'src', 'app', 'lib', 'copilot.ts');
const nodeHubPath = path.join(root, 'src', 'app', 'pages', 'MistakeNodeHubPage.tsx');

const apiSource = readFileSync(apiPath, 'utf-8');
const copilotSource = readFileSync(copilotPath, 'utf-8');
const nodeHubSource = readFileSync(nodeHubPath, 'utf-8');

assert.match(copilotSource, /export function collectMissingTagExtensions\(/, '缺少新标签检测函数 collectMissingTagExtensions');
assert.match(nodeHubSource, /title:\s*'发现新标签，是否创建\？'/, '缺少“新标签确认创建”弹窗');
assert.match(nodeHubSource, /const canCreateTags = await registerTagExtensions\(draft\);/, '缺少标签创建确认阻断逻辑');
assert.match(nodeHubSource, /if \(!canCreateTags\) return;/, '缺少用户拒绝后的中断逻辑');
assert.match(apiSource, /标签必须精确：knowledge_point、ability、error_type 必须从系统给定标签库中挑最贴近项/, '缺少标签精确规则');
assert.match(apiSource, /每次建议 create_mistake 或 update_tags 时，都要额外给出 update_learning_content 所需内容/, '缺少知识点联动规则');
assert.match(apiSource, /questionsApi\.getAll\(\{ sortBy: 'latestWrong' \}, \{ forceRefresh: true \}\)/, '弱点画像未强制刷新错题数据');
assert.match(apiSource, /weaknessApi\.getAll\(\{ forceRefresh: true \}\)/, '弱点画像未强制刷新弱点数据');
assert.match(nodeHubSource, /syncKnowledgeFromMistake\(created\);/, '新增错题后未联动知识点沉淀');
assert.match(nodeHubSource, /syncKnowledgeFromMistake\(updated\);/, '更新错题后未联动知识点沉淀');

process.stdout.write('AI guardrails acceptance checks passed.\n');
