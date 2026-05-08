# AI 入库链路重构进度

## 当前里程碑
- [x] Task 1: 回归护栏
- [x] Task 2: 标签树服务解耦（move/rename/delete/category sync）
- [x] Task 3: 入库策略抽离（校验与标准化）
- [x] Task 4: AI 动作约束收口（核心动作契约）

## 最近变更
- 日期：2026-05-08
- 提交：已提交主链路重构，当前有一批增量解耦待提交
- 影响范围：`web/scripts`、`web/src/app/lib`、`web/src/app/pages`、`docs/superpowers`
- 验证结果：`npm run test:acceptance:draft-import` 通过；`npm run typecheck` 通过；IDE Diagnostics 为 0
- 回滚点：可按文件粒度回滚（`tagTreeService.ts`、`draftImportPolicy.ts`、`aiActionContract.ts` 互相独立）

## 本轮增量（继续执行）
- `DraftReviewPage.tsx` 再次减重：选项解析与预览题干拼装下沉到 `draftImportPolicy.ts`。
- `draftImportPolicy.ts` 新增 `resolveDraftOptionLines` 与 `buildDraftPreviewTextForStorage`，统一页面与入库前逻辑。
- `MistakeBookPage.tsx` 再次减重：分类重命名后台同步下沉到 `tagTreeService.syncRenameCategory`。
- 已验证：`npm run test:acceptance:draft-import`、`npm run typecheck` 通过。

## 下一步建议
- 将 `DraftReviewPage.tsx` 的执行分支按“草稿准备 / 去重 / 入库执行”继续拆分，降低文件复杂度。
- 按同样方式继续把 `MistakeBookPage.tsx` 的 category rename 相关写操作下沉到服务层。
- 在 acceptance 脚本中增加“delete/category sync 已接入 tag service”的断言，进一步防回归。
