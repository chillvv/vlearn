# Phase 3 AI Live 告警摘要

## 报表信息
- 生成时间：`2026-04-05T04:58:30.797Z`
- 数据源：`local-api` 本地数据库
- 数据库连接：`postgres://root:****@localhost:54333/vlearn`
- 最近样本时间：`2026-04-05T04:58:10.128Z`

## 状态
- 当前级别：`warning`
- 结论：当前存在可恢复风险，建议在继续扩量前先完成原因定位。

## 指标
- 样本量：`9`
- AI 样本量：`4`
- fallback 样本量：`5`
- fallback 占比：`55.56%`
- planner_timeout 次数：`0`
- schema_invalid 次数：`0`
- 平均规划延迟：`4.0 ms`
- fallback 原因分布：planner_disabled=5

## 建议动作
- 优先查看 phase3-live-execution-report.md 的来源分布
- 结合运行手册回溯具体 request_id
