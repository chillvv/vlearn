# 学习编排灰度与回滚方案

## 灰度开关

| 开关 | 默认策略 | 作用 |
| --- | --- | --- |
| `learning_session_orchestrator` | 开启 | 统一 practice、review、AI handoff 的 proposal 解析与跳转协议 |
| `copilot_capability_surface` | 开启 | 草稿页与节点页统一只展示“录入整理 / 讲解追问 / 计划推荐 / 跳转启动”四类前台能力 |
| `copilot_handoff_card` | 开启 | practice / review 在跳转前必须展示可调整、可取消的 handoff card |
| `copilot_result_return` | 开启 | 正式学习结果页展示“回 AI 管家继续”回流入口 |
| `learning_task_resume` | 开启 | review / practice 进行中的任务支持跨页、切页、刷新恢复 |

## 回滚策略

- 若 handoff 接受率显著下降，先关闭 `copilot_handoff_card`，保留推荐说明但不阻塞用户从既有入口进入正式学习页。
- 若正式学习页来源透传异常，先关闭 `copilot_result_return`，保留正式学习主流程，避免错误 return path 干扰结果页。
- 若恢复逻辑导致状态错乱，先关闭 `learning_task_resume`，仅保留完成与取消时的显式清理。
- 若统一 proposal 解析出现兼容问题，保留 `learning_session_orchestrator` 主链路，但继续接受 legacy query 与 preset 恢复。

## 观测看板

### 入口与接受

- AI handoff 曝光率：进入草稿页或节点页后，出现 practice / review handoff card 的会话占比
- AI handoff 接受率：展示 handoff card 后点击“立即开始”的占比
- AI handoff 调整率：展示 handoff card 后点击“调整范围”并继续开始的占比
- AI handoff 取消率：展示 handoff card 后点击“取消”或关闭弹窗的占比

### 正式学习完成

- practice 进入率：从 AI、Dashboard、review 结果页进入专项练习的会话占比
- review 进入率：从 AI、Dashboard、practice 结果页进入复习中心的会话占比
- practice 完成率：进入专项练习后完成结果页的占比
- review 完成率：进入复习中心后完成总结页的占比

### 切换与回退

- practice→review 切换率：专项练习结果页点击“去复习”的占比
- review→practice 切换率：复习结束页点击“去专项补弱”的占比
- fallback 率：practice 出题、判题或 review 规划进入 fallback 的占比
- 未完成任务恢复成功率：刷新、切页或跨页后成功恢复到原任务卡片的占比

## 指标口径

- 进入率分母统一为“展示对应入口的有效会话数”，不把无权限、无数据与主动取消算入成功。
- 完成率分母统一为“已创建正式学习 proposal 并进入正式学习页的会话数”。
- fallback 率至少拆分为 `generation_fallback`、`judge_fallback`、`planner_fallback` 三类来源。
- AI handoff 接受率必须同时按 `source_surface`、`session_kind`、`objective_code` 分组查看。

## 灰度期巡检

- 每日检查 practice 进入率、review 进入率、practice 完成率、review 完成率、fallback 率与 AI handoff 接受率。
- 每周检查 practice→review 切换率、review→practice 切换率与未完成任务恢复成功率。
- 若任一核心指标连续两个观察窗口显著劣化，优先按回滚策略缩小影响面，再定位 proposal 透传、handoff card 或恢复链路。

## 灰度结束后的清理项

- 删除用户可见的旧模式文案，只保留四类前台能力。
- 清理聊天区中隐式承载完整正式练习 / 复习流程的旧文案与旧分支。
- 保留 legacy query / preset 兼容读取，但仅作为恢复链路，不再作为新增入口协议。
- 复核结果页“回 AI 管家继续”与 return path 是否都使用统一 proposal 透传字段。
