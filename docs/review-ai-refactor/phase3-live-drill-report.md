# Phase 3 AI Live 演练记录

## 报表信息
- 生成时间：`2026-04-05T04:58:10.389Z`
- 演练用户：`359ed1b4-913b-41a2-8d9f-f597d0f2084c`
- 演练学科：`C语言`
- 候选题数：`8`

## 样本结果
| case | request_id | plan_source | plan_version | fallback_reason | latency_ms | created_at |
| --- | --- | --- | --- | --- | ---: | --- |
| ai-live | 1fec461c-e21b-4f38-a8f8-029603875704 | ai | review-ai-live-v2-due-rescue | — | 10 | 2026-04-05T04:58:08.741Z |
| planner-disabled-fallback | 23a1ca06-3ad3-40a5-9b5b-42382560972e | rule_fallback | review-ai-live-v2-due-rescue-fallback | planner_disabled | 0 | 2026-04-05T04:58:10.128Z |

## 结论
- 本次演练同时生成 AI 成功与规则 fallback 两类 telemetry 样本，可直接用于 Phase 3 日报与告警摘要。
- 若后续需要继续扩充样本，可重复执行 `npm run drill:review-ai:live`。
- 下一步建议依次执行 `npm run report:review-ai:live-execution` 与 `npm run report:review-ai:live-alerts`。
