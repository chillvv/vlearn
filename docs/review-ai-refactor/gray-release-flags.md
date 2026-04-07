# Review AI 灰度开关说明

## 前端开关

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_REVIEW_AI_PLANNER_ENABLED` | `false` | 是否允许进入 AI Planner 主链路 |
| `VITE_REVIEW_AI_FALLBACK_ENABLED` | `true` | AI 失败后是否允许规则回退 |
| `VITE_REVIEW_AI_SHADOW_MODE` | `true` | 是否保留历史旁路能力 |
| `VITE_REVIEW_AI_GRAY_PERCENT` | `0` | 灰度比例，范围 `0-100` |
| `VITE_REVIEW_AI_DUE_MIN_RATIO` | `0.4` | due 覆盖护栏比例，范围 `0-1` |

## local-api 开关

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `REVIEW_AI_PLANNER_ENABLED` | `false` | local-api 是否允许执行 AI Planner |
| `REVIEW_AI_FALLBACK_ENABLED` | `true` | local-api 是否允许规则回退 |
| `REVIEW_AI_SHADOW_MODE` | `true` | 是否允许 shadow 路径保留 |
| `REVIEW_AI_GRAY_PERCENT` | `0` | 灰度比例，范围 `0-100` |
| `REVIEW_AI_DUE_MIN_RATIO` | `0.4` | due 覆盖护栏比例，范围 `0-1` |

## 行为约定

- 灰度命中判定统一在 `runReviewPlanner` 入口完成，并透传 `gray_percent`、`gray_bucket`、`selected`、`page_number`。
- 未命中灰度时返回 `rule_fallback`，并记录 `fallback_reason=gray_not_selected`。
- 关闭 Planner 时返回 `rule_fallback`，并记录 `fallback_reason=planner_disabled`。
- 所有 live telemetry 与日报都应基于同一份 rollout metadata 观察放量效果。
