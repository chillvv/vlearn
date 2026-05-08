# AI 入库链路收口与标签模块解耦 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改数据库选型、不推翻现有交互的前提下，先稳定“批量错题 -> AI 标签草稿 -> 卡片确认 -> 精准入库”主链路，并把标签拖拽/分类逻辑从巨型页面中解耦。

**Architecture:** 采用“先测试护栏、再拆逻辑、最后回接页面”的渐进式重构。保留现有 UI 与交互行为，提取 `tag-tree` 和 `draft-import-policy` 两个领域模块，并将 AI 动作协议约束集中到单一入口，减少分散规则和回归风险。

**Tech Stack:** React + TypeScript + TanStack Query + react-sortablejs + 现有 acceptance 脚本（Node assert）

---

### Task 1: 建立回归护栏（先写失败检查）

**Files:**
- Create: `web/scripts/acceptance-draft-import-guardrails.mjs`
- Modify: `web/package.json`
- Test: `web/scripts/acceptance-draft-import-guardrails.mjs`

- [ ] **Step 1: 写失败的 acceptance 检查脚本（先约束目标结构）**

```js
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';

const root = path.resolve(process.cwd());
const draftPagePath = path.join(root, 'src', 'app', 'pages', 'DraftReviewPage.tsx');
const tagPagePath = path.join(root, 'src', 'app', 'pages', 'MistakeBookPage.tsx');
const policyPath = path.join(root, 'src', 'app', 'lib', 'draftImportPolicy.ts');
const tagServicePath = path.join(root, 'src', 'app', 'lib', 'tagTreeService.ts');

const draftPage = readFileSync(draftPagePath, 'utf-8');
const tagPage = readFileSync(tagPagePath, 'utf-8');
const policySource = readFileSync(policyPath, 'utf-8');
const tagServiceSource = readFileSync(tagServicePath, 'utf-8');

assert.match(policySource, /export function validateDraftsBeforeImportPolicy\(/, '缺少统一入库校验策略');
assert.match(policySource, /export function normalizeDraftForImportPolicy\(/, '缺少统一入库标准化策略');
assert.match(tagServiceSource, /export async function moveNodeTag\(/, '缺少标签跨分类移动服务');
assert.match(tagServiceSource, /export async function renameNodeTag\(/, '缺少标签重命名服务');
assert.match(draftPage, /validateDraftsBeforeImportPolicy\(/, 'DraftReviewPage 未接入统一入库校验策略');
assert.match(draftPage, /normalizeDraftForImportPolicy\(/, 'DraftReviewPage 未接入统一入库标准化策略');
assert.match(tagPage, /moveNodeTag\(/, 'MistakeBookPage 未接入标签移动服务');
assert.match(tagPage, /renameNodeTag\(/, 'MistakeBookPage 未接入标签重命名服务');

process.stdout.write('Draft import and tag decouple guardrails passed.\\n');
```

- [ ] **Step 2: 运行脚本，确认当前失败**

Run: `npm run test:acceptance:draft-import`  
Expected: FAIL，提示 `ENOENT`（新文件尚未创建）或匹配失败

- [ ] **Step 3: 在 package.json 增加脚本入口**

```json
{
  "scripts": {
    "test:acceptance:draft-import": "node scripts/acceptance-draft-import-guardrails.mjs"
  }
}
```

- [ ] **Step 4: 再运行一次，确认仍失败（测试先行）**

Run: `npm run test:acceptance:draft-import`  
Expected: FAIL，提示缺少 `draftImportPolicy.ts` / `tagTreeService.ts`

- [ ] **Step 5: Commit**

```bash
git add web/scripts/acceptance-draft-import-guardrails.mjs web/package.json
git commit -m "test: add acceptance guardrails for draft import and tag decouple"
```

### Task 2: 抽离标签树服务（不改交互，只改职责）

**Files:**
- Create: `web/src/app/lib/tagTreeService.ts`
- Modify: `web/src/app/pages/MistakeBookPage.tsx`
- Test: `web/scripts/acceptance-draft-import-guardrails.mjs`

- [ ] **Step 1: 写失败检查（确保页面改为调用服务）**

Run: `npm run test:acceptance:draft-import`  
Expected: FAIL，提示 `MistakeBookPage 未接入标签移动服务`

- [ ] **Step 2: 新建标签树服务，承接页面中的核心动作**

```ts
import type { QueryClient } from '@tanstack/react-query';
import type { Subject, Question } from './types';
import { questionsApi } from './api';
import { getKnowledgeNodeMeta, registerCustomKnowledgeTaxonomy, removeCustomKnowledgeTaxonomy, renameCustomKnowledgeTaxonomy } from './knowledgeTaxonomy';
import { queryKeys } from './queryKeys';

export async function moveNodeTag(input: {
  subject: Subject;
  nodeValue: string;
  targetCategory: string;
  questions: Question[];
}) {
  const node = input.nodeValue.trim();
  const category = input.targetCategory.trim();
  if (!node || !category) return;
  const meta = getKnowledgeNodeMeta(input.subject, node);
  if (meta.category === category) return;
  await registerCustomKnowledgeTaxonomy(node, category, meta.branch || '默认分类', input.subject);
  const affectedIds = input.questions.filter((q) => q.knowledge_point === node).map((q) => q.id);
  if (affectedIds.length > 0) {
    await questionsApi.batchUpdate(affectedIds, { knowledge_point: node, category, ability: meta.branch, node });
  }
}

export async function renameNodeTag(input: {
  subject: Subject;
  oldValue: string;
  nextValue: string;
  questions: Question[];
}) {
  const oldValue = input.oldValue.trim();
  const nextValue = input.nextValue.trim();
  if (!oldValue || !nextValue || oldValue === nextValue) return;
  await renameCustomKnowledgeTaxonomy(oldValue, nextValue, input.subject);
  const affectedIds = input.questions.filter((q) => q.knowledge_point === oldValue).map((q) => q.id);
  if (affectedIds.length > 0) {
    const meta = getKnowledgeNodeMeta(input.subject, nextValue);
    await questionsApi.batchUpdate(affectedIds, {
      knowledge_point: nextValue,
      category: meta.category,
      ability: meta.branch,
      node: meta.node,
    });
  }
}
```

- [ ] **Step 3: 页面替换为服务调用（先替换 move/rename 两个高风险动作）**

```ts
import { moveNodeTag, renameNodeTag } from '../lib/tagTreeService';

await renameNodeTag({
  subject,
  oldValue,
  nextValue,
  questions,
});

await moveNodeTag({
  subject,
  nodeValue: normalizedNode,
  targetCategory: normalizedTargetCategory,
  questions,
});
```

- [ ] **Step 4: 运行检查，确认通过**

Run: `npm run test:acceptance:draft-import`  
Expected: PASS（至少不再报 tag service 缺失）

- [ ] **Step 5: Commit**

```bash
git add web/src/app/lib/tagTreeService.ts web/src/app/pages/MistakeBookPage.tsx
git commit -m "refactor: extract tag tree move/rename logic into service"
```

### Task 3: 抽离入库策略模块（保守模式规则集中化）

**Files:**
- Create: `web/src/app/lib/draftImportPolicy.ts`
- Modify: `web/src/app/pages/DraftReviewPage.tsx`
- Test: `web/scripts/acceptance-draft-import-guardrails.mjs`

- [ ] **Step 1: 写失败检查（页面必须引用统一策略）**

Run: `npm run test:acceptance:draft-import`  
Expected: FAIL，提示 `DraftReviewPage 未接入统一入库校验策略`

- [ ] **Step 2: 新建统一策略模块**

```ts
import type { Question } from './types';
import { formatQuestionTextForStorage, parseQuestionPreview } from './questionPreview';
import { getKnowledgePointsBySubjectFromTaxonomy } from './knowledgeTaxonomy';

export type DraftQuestion = Partial<Question> & { options?: string[] };

export function validateDraftsBeforeImportPolicy(items: DraftQuestion[]) {
  const issues: string[] = [];
  items.forEach((draft, index) => {
    const label = `第 ${index + 1} 题`;
    const subject = String(draft.subject || '英语') as '英语' | 'C语言';
    const questionText = String(draft.question_text || '').trim();
    const point = String(draft.knowledge_point || '').trim();
    const note = String(draft.note || '').trim();
    const options = Array.isArray(draft.options) ? draft.options.filter(Boolean) : [];
    const validPoints = getKnowledgePointsBySubjectFromTaxonomy(subject);

    if (!questionText) issues.push(`${label}缺少题干，请先补充再入库。`);
    if (!point || !validPoints.includes(point)) issues.push(`${label}的知识点必须从标签库中选择。`);
    if ((draft.question_type === 'choice' || options.length > 0) && options.length < 2) issues.push(`${label}是选择题时至少需要 2 个选项。`);
    if (!note) issues.push(`${label}缺少解析/笔记，请先补充再入库。`);
  });
  return issues;
}

export function normalizeDraftForImportPolicy(draft: DraftQuestion) {
  const stem = String(draft.question_text || '').trim();
  const parsed = parseQuestionPreview(stem);
  const options = Array.isArray(draft.options) && draft.options.length > 0 ? draft.options : parsed.options.map((o) => `${o.label}. ${o.text}`);
  return {
    ...draft,
    subject: draft.subject === 'C语言' ? 'C语言' : '英语',
    knowledge_point: String(draft.knowledge_point || '').trim(),
    question_text: formatQuestionTextForStorage(stem, options),
    note: String(draft.note || '').trim(),
    options,
  } satisfies Partial<Question> & { options?: string[] };
}
```

- [ ] **Step 3: 页面替换内联校验/标准化逻辑为策略调用**

```ts
import { validateDraftsBeforeImportPolicy, normalizeDraftForImportPolicy } from '../lib/draftImportPolicy';

const validationIssues = validateDraftsBeforeImportPolicy(itemsToCreate);
if (validationIssues.length > 0) throw new Error(validationIssues[0]);

const preparedItems = itemsToCreate.map((draft) => normalizeDraftForImportPolicy(draft));
```

- [ ] **Step 4: 运行检查，确认通过**

Run: `npm run test:acceptance:draft-import`  
Expected: PASS（draft import policy 相关断言通过）

- [ ] **Step 5: Commit**

```bash
git add web/src/app/lib/draftImportPolicy.ts web/src/app/pages/DraftReviewPage.tsx
git commit -m "refactor: extract conservative draft import policy from DraftReviewPage"
```

### Task 4: 收口 AI 动作约束（不改能力面，先降噪）

**Files:**
- Create: `web/src/app/lib/aiActionContract.ts`
- Modify: `web/src/app/lib/copilot.ts`
- Modify: `web/src/app/lib/api.ts`
- Test: `web/scripts/acceptance-draft-import-guardrails.mjs`

- [ ] **Step 1: 先写失败检查（新增动作约束集中模块）**

```js
assert.match(readFileSync(path.join(root, 'src', 'app', 'lib', 'aiActionContract.ts'), 'utf-8'), /export const CORE_INGEST_ACTIONS/, '缺少入库核心动作白名单');
assert.match(readFileSync(path.join(root, 'src', 'app', 'lib', 'copilot.ts'), 'utf-8'), /isCoreIngestAction/, 'copilot 未使用统一动作判定');
```

Run: `npm run test:acceptance:draft-import`  
Expected: FAIL（文件/符号不存在）

- [ ] **Step 2: 新建动作协议中心，保留兼容但聚焦主链路**

```ts
export const CORE_INGEST_ACTIONS = ['create_mistake', 'update_tags'] as const;
export type CoreIngestAction = (typeof CORE_INGEST_ACTIONS)[number];

export function isCoreIngestAction(input: unknown): input is CoreIngestAction {
  return typeof input === 'string' && (CORE_INGEST_ACTIONS as readonly string[]).includes(input);
}
```

- [ ] **Step 3: `copilot.ts` 接入核心动作判定，避免分散硬编码**

```ts
import { isCoreIngestAction } from './aiActionContract';

if (!actionType || !SUPPORTED_COPILOT_ACTIONS.includes(actionType)) return null;
// 在入库模式分支中优先判定核心动作
if (currentCapability === 'organize' && !isCoreIngestAction(actionType) && actionType !== 'update_learning_content') {
  // 保持兼容：非核心动作不执行写入链路
}
```

- [ ] **Step 4: `api.ts` 将超长 prompt 拆分成基础段 + 入库段，降低维护噪声**

```ts
const AI_COPILOT_BASE_RULES = `...`;
const AI_COPILOT_INGEST_RULES = `...create_mistake / update_tags 约束...`;
const AI_COPILOT_PROMPT = `${AI_COPILOT_BASE_RULES}\n\n${AI_COPILOT_INGEST_RULES}`;
```

- [ ] **Step 5: 运行验收与类型检查**

Run: `npm run test:acceptance:draft-import`  
Expected: PASS  

Run: `npm run typecheck`  
Expected: PASS（0 errors）

- [ ] **Step 6: Commit**

```bash
git add web/src/app/lib/aiActionContract.ts web/src/app/lib/copilot.ts web/src/app/lib/api.ts web/scripts/acceptance-draft-import-guardrails.mjs
git commit -m "refactor: centralize ai ingest action contract and split prompt sections"
```

### Task 5: 进度文档与执行回滚点（防中断丢进度）

**Files:**
- Create: `docs/superpowers/progress/2026-05-08-ai-ingestion-refactor-progress.md`
- Modify: `docs/superpowers/plans/2026-05-08-ai-ingestion-tag-decouple.md`
- Test: `web/scripts/acceptance-draft-import-guardrails.mjs`

- [ ] **Step 1: 创建进度文档模板（每次任务结束即更新）**

```md
# AI 入库链路重构进度

## 当前里程碑
- [ ] Task 1: 回归护栏
- [ ] Task 2: 标签树服务解耦
- [ ] Task 3: 入库策略抽离
- [ ] Task 4: AI 动作约束收口

## 最近变更
- 日期：
- 提交：
- 影响范围：
- 验证结果：
- 回滚点：
```

- [ ] **Step 2: 每完成一个 Task，写入“验证结果 + 回滚点”**

Run: `npm run test:acceptance:draft-import`  
Expected: PASS（作为每次记录前置）

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/progress/2026-05-08-ai-ingestion-refactor-progress.md docs/superpowers/plans/2026-05-08-ai-ingestion-tag-decouple.md
git commit -m "docs: add progress tracker for ai ingestion refactor"
```

---

## Self-Review

- Spec coverage: 已覆盖你确认的两条主线（标签模块解耦 + AI 入库链路稳定），并保留“保守模式、人工确认、按知识点分组”约束。
- Placeholder scan: 计划内无 TBD/TODO，每个任务包含明确文件、命令、预期结果与提交点。
- Type consistency: 统一使用 `DraftQuestion`、`moveNodeTag`、`renameNodeTag`、`validateDraftsBeforeImportPolicy`、`normalizeDraftForImportPolicy` 命名，避免后续执行时符号漂移。
