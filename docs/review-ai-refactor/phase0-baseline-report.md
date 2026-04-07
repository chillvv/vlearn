# Phase 0 复习基线报告

## 报表信息
- 生成时间：`2026-04-05T04:57:43.121Z`
- 数据源：`local-api` 本地数据库
- 数据库连接：`postgres://root:****@localhost:54333/vlearn`
- 事实表：`public.question_review_attempts`、`public.questions`

## 基线总览
| 指标 | 值 |
| --- | --- |
| 7 日复习尝试数 | 72 |
| 7 日覆盖题目数 | 72 |
| 7 日正确率 | 62.50% |
| 48h 再错样本数 | 0 |
| 48h 再错率 | — |
| 题目总量 | 397 |
| active 题量 | 397 |
| overdue backlog | 255 |
| active 缺 due 数 | 0 |

## 指标说明
- 7 日正确率：近 7 天 `question_review_attempts` 中 `is_correct=true` 的占比。
- 48h 再错率：同一用户同一题目一次错误后，48 小时内下一次复习仍错误的占比。
- overdue backlog：当前未归档且 `next_review_date <= NOW()` 的题目数。
- active 缺 due 数：当前未归档且 `next_review_date IS NULL` 的题目数。

## 结构摘要
- overdue 学科分布：C语言=165，英语=90

## 风险提示
- 当前未观测到可用于计算 48 小时再错率的连续复习样本。

## 结论
- 当前基线报表已覆盖 Phase 0 要求的 7 日正确率、48h 再错率、overdue backlog 与 active 缺 due 数。
- 后续扩大灰度时，可重复执行 `npm run report:review-ai:baseline` 作为放量前后的对照基线。
