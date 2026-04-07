# Phase 3 AI Live 回溯与定位手册

## 1. 快速入口

- 生成 live 演练样本：`npm run drill:review-ai:live`
- 生成执行日报：`npm run report:review-ai:live-execution`
- 生成告警摘要：`npm run report:review-ai:live-alerts`
- 执行验收检查：`npm run test:acceptance:review-ai`

## 1.1 最新本地验收快照（2026-04-05）

- 当前 `review_plan_telemetry` 已沉淀 4 条 live 样本，其中 `ai=2`、`rule_fallback=2`
- 当前执行日报指标：平均规划延迟 `4.5 ms`、平均 due 覆盖率 `100.00%`
- 当前告警级别：`warning`，主要原因是演练样本中的 `planner_disabled=2`
- 当前结论：Phase 3 收尾闭环已完成，后续进入 Phase 4 的真实流量观测与扩量优化

## 2. 关键字段怎么用

- `request_id`：一次 live planner 调用的唯一入口，用来串联演练记录、日报样本与数据库明细
- `plan_source`：`ai` 表示 AI 计划直接执行，`rule_fallback` 表示触发了规则兜底
- `plan_version`：当前计划模板版本，格式为 `review-ai-live-v1-<strategy>`，用于回看策略模板是否切换
- `fallback_reason`：常见值包括 `planner_disabled`、`planner_timeout`、`schema_invalid`、`request_failed`
- `comparison_summary`：用于看执行队列长度、due 覆盖率、fallback 注记
- `risk_flags`：用于看策略标签和风险位，例如 `strategy_template`、`strategy_label`

## 3. 定位路径

### 3.1 发现 fallback 占比升高

1. 先看 `phase3-live-alert-report.md` 中的 `fallback 占比` 与 `fallback 原因分布`
2. 再看 `phase3-live-execution-report.md` 中的 `计划来源分布`、`fallback 原因分布`、`样本`
3. 以 `request_id` 为入口，在 `review_plan_telemetry` 中查看该条记录的 `request_summary`、`comparison_summary`、`risk_flags`
4. 如 `fallback_reason=planner_disabled`，优先检查 `REVIEW_AI_PLANNER_ENABLED`
5. 如 `fallback_reason=planner_timeout`，优先检查模型调用超时或环境不可达
6. 如 `fallback_reason=schema_invalid`，优先检查 planner 输出 JSON 结构与 queue 内容

### 3.2 发现 AI 样本为 0

1. 先执行 `npm run drill:review-ai:live`
2. 如果 drill 仍只生成 fallback，检查 local-api 启动时是否注入了 `REVIEW_AI_PLANNER_ENABLED=true`
3. 若 planner 已开启但仍未生成 `ai`，回看 `web/local-api/server.mjs` 中 `requestPlannerOutput` 与护栏结果

### 3.3 发现 due 覆盖率异常

1. 在执行日报中查看 `平均 due 覆盖率`
2. 用对应 `request_id` 查看 `comparison_summary.execution_due_ratio`
3. 若覆盖率过低，优先检查请求时的 `due_min_ratio`、候选集题量与 `scope`

## 4. 代码入口

- 统一前端入口：`web/src/app/lib/api.ts` 的 `runReviewPlanner`
- 前端接入页：`web/src/app/pages/ReviewModePage.tsx`
- local-api live planner：`web/local-api/server.mjs` 的 `/api/review/planner/live`
- 日报脚本：`web/scripts/report-review-ai-live-execution.mjs`
- 告警脚本：`web/scripts/report-review-ai-live-alerts.mjs`
- 演练脚本：`web/scripts/run-review-ai-live-drill.mjs`

## 5. 接手清单

1. 先看 `AI_复习智能化重构执行进度.md` 的“当前状态”和“下一次继续执行入口”
2. 再看最近一版 drill、日报、告警三个 Markdown 产物
3. 如需复现，先确保本地数据库可连接，再按“快速入口”重新执行
4. 归档后的 OpenSpec 记录位于 `openspec/changes/archive/2026-04-05-*`
5. 新的排查结论继续同步回执行进度文档，保持接手链路连续
