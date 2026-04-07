# Review AI Live 执行日报

## 报表信息
- 生成时间：`2026-04-05T04:58:18.267Z`
- 数据源：`local-api` 本地数据库
- 数据库连接：`postgres://root:****@localhost:54333/vlearn`
- 统计对象：`public.review_plan_telemetry`
- 样本量：`9`

## 总览
- AI 执行占比：`44.44%`
- 规则 fallback 占比：`55.56%`
- 全量平均规划延迟：`4.0 ms`
- AI 成功平均规划延迟：`9.0 ms`
- 平均执行队列长度：`6.00`
- 平均 due 覆盖率：`100.00%`

## 分布摘要
- 计划来源分布：rule_fallback=5，ai=4
- fallback 原因分布：planner_disabled=5
- rollout selected 分布：false=7，true=2
- rollout percent 分布：未标记=4，0=3，100=2
- rollout bucket 分布：未标记=4，0=3，99=2
- 策略模板分布：到期抢救=9
- plan_version 分布：review-ai-live-v2-due-rescue-fallback=3，review-ai-live-v1-due-rescue=2，review-ai-live-v1-due-rescue-fallback=2，review-ai-live-v2-due-rescue=2
- 风险标记分布：notes=4

## 样本
| request_id | created_at | plan_source | fallback_reason | strategy | plan_version | rollout_selected | rollout_percent | latency_ms | execution_count |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: |
| 23a1ca06-3ad3-40a5-9b5b-42382560972e | Sun Apr 05 2026 12:58:10 GMT+0800 (中国标准时间) | rule_fallback | planner_disabled | 到期抢救 | review-ai-live-v2-due-rescue-fallback | false | 0 | 0 | 6 |
| 1fec461c-e21b-4f38-a8f8-029603875704 | Sun Apr 05 2026 12:58:08 GMT+0800 (中国标准时间) | ai | — | 到期抢救 | review-ai-live-v2-due-rescue | true | 100 | 10 | 6 |
| 0cc68170-6636-46e6-8bbb-8032fff8ba74 | Sun Apr 05 2026 12:44:22 GMT+0800 (中国标准时间) | rule_fallback | planner_disabled | 到期抢救 | review-ai-live-v2-due-rescue-fallback | false | 0 | 0 | 6 |
| ae5ce938-4abb-4a31-af0e-d637c193986d | Sun Apr 05 2026 12:44:21 GMT+0800 (中国标准时间) | ai | — | 到期抢救 | review-ai-live-v2-due-rescue | true | 100 | 8 | 6 |
| 9f05a101-2b5a-42dd-b290-e1ec79f4715d | Sun Apr 05 2026 12:42:59 GMT+0800 (中国标准时间) | rule_fallback | planner_disabled | 到期抢救 | review-ai-live-v2-due-rescue-fallback | false | 0 | 0 | 6 |

## 结论
- 当前日报已覆盖 AI 占比、fallback 率、rollout 命中、计划版本、策略模板与风险标记，可作为 Phase 4 扩量观测入口。
- 若 fallback 占比持续高于预期，优先回查 `fallback_reason`、`request_summary.rollout` 与 `plan_version`，确认是灰度命中问题、模型问题还是护栏问题。
