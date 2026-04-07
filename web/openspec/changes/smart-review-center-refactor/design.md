## Context

当前的复习中心页面（ReviewModePage）存在三大问题：
1. UI 层面上充斥着无用信息（本轮目标、推荐原因、7天活跃度），对核心复习路径（进入-分包-做题-反馈）造成干扰。
2. 任务颗粒度过大，动辄 100+ 题的复习队列让用户产生极强的抵触情绪和压迫感，缺乏成就感驱动。
3. 底层缓存刷新机制不及时，复习过程中退出再进时依然加载已完成题目的旧缓存（本地持久化和 query 缓存未正确同步），导致用户体验极差。

同时，AI 管家（Copilot）作为跳转到复习中心的重要入口，它当前生成的跳转提示词和意图也需要配合这种“分包（Chunking）”的新复习模式进行更新。

## Goals / Non-Goals

**Goals:**
- 将原本“大锅乱炖”的错题队列通过 AI Planner 的不同策略自动切分成 2~3 个特定目标的小型“任务包”（如“高频易错突击”、“近期遗忘抢救”）。
- 提供明确的“学科选择”维度，隔离不同学科的复习状态。
- 重构页面顶部的静态废话区域，替换为具有直接行动指引的“今日分包任务卡片”。
- 修复状态同步和持久化 Bug，确保已完成题目在退出后立即从队列和缓存中移除，不再被捞出。
- 对齐 AI 管家生成复习计划时的 Prompt 逻辑。

**Non-Goals:**
- 不修改底层题目入库逻辑或 `submit_review_attempt` RPC 的核心评分算法。
- 不引入全新的第三方图表库。

## Decisions

**1. UI 与组件结构重构**
- 移除顶部的 `sourceLabel`、`planSummary` 废话区块以及下方的 Recharts 7天活跃度图表。
- 引入“任务包”UI 模式：在 `status === 'ready'` 状态下，预先计算/拉取当前用户的到期错题，并按策略划分为若干个卡片。每个卡片展示 10-20 题，拥有独立的“开始这组任务”按钮。
- 在 `ready` 状态上方增加“选择学科”的 Toggle 按钮，所有下方数据展示基于该学科过滤。

**2. 任务包数据流与 AI Planner 联动**
- 当前是用户点击“开始”后才调用 `runReviewPlanner`。改为在页面加载或切换学科时，通过 `queries/questions.ts` 异步拉取不同策略（如 `due-rescue`、`stubborn-focus`）的预览数据（题目数量和特征）。
- 点击“开始这组任务”时，直接将该策略参数传递给 `runReviewPlanner`，生成限定数量（如 15 题）的具体队列。

**3. 缓存更新与状态清理机制**
- **当前问题**：前端使用 `sessionPlanUpdated` 计数器在组件卸载时触发全局缓存刷新，但如果在同一会话内点击“退出”回到 ready，本地 `active-review-task` 和 react-query 缓存没有被立刻清理和作废。
- **解决方案**：在 `handleExit`（退出并返回复习中心）中，不仅调用 `clearPersistedReviewTask()` 和清空 state，还要主动调用 `queryClient.invalidateQueries` 使 `questions` 和 `dueCount` 相关的 query 立即失效，强制重新拉取最新列表，从而确保不会再次刷出刚做完的题目。

**4. AI Copilot Prompt 适配**
- 修改 `AI_COPILOT_PROMPT`（位于 `api.ts`）和 `buildCopilotModePrompt`，将原本建议“整体复习”的措辞调整为“按专项/分包复习”。
- 调整 `copilotMode.ts`，确保其理解复习中心支持通过不同 `scope` 或 `strategy` 接收分包任务。

## Risks / Trade-offs

- **Risk: 异步预加载任务包带来的性能开销**
  - Mitigation: 不在 ready 状态下对每个包调用完整的重排接口（Planner API），而是通过轻量级的 count 查询或缓存策略，仅展示包的数量估算，待用户真正点击“开始”时再调用大模型的 Planner 排序。
- **Risk: 缓存频繁失效导致的体验顿挫**
  - Mitigation: 仅在明确发生有效提交（`sessionReviewed > 0`）且退出时失效缓存，避免无意义的网络请求。乐观更新已完成的题目状态。