## ADDED Requirements

### Requirement: Review Subject Filter
用户必须能够在智能复习入口上方选择特定的学科（英语或 C语言），从而隔离不同学科的复习任务和待办数据。

#### Scenario: Switching subjects on Ready page
- **WHEN** the user selects "英语" or "C语言" from the subject toggle
- **THEN** The displayed task packages, due count, and custom review parameters update to reflect only the selected subject's data.

## MODIFIED Requirements

### Requirement: Review Session Management
系统必须确保复习状态的准确同步。在用户退出复习（无论是正常完成还是中途退出）时，系统不仅要清除本地持久化的 `active-review-task`，还必须立即使关联的 React Query 缓存（如 `questions` 列表查询）失效，以防止下次进入时重复加载已完成的题目。

#### Scenario: Exiting a review session early
- **WHEN** the user clicks "退出" during an active review session
- **THEN** The system prompts for confirmation if there are unfinished items.
- **THEN** Upon confirmation, the system clears the local storage persisted task, resets component state (cards, currentIndex, status), and invalidates react-query cache for `questions` to ensure the next session pulls fresh data.

### Requirement: Copilot Review Handoff
AI 管家（Copilot）在生成复习计划（start_review）时，其内部 Prompt 和行为表现必须适配新的“分包复习”理念。

#### Scenario: Copilot generating review plan
- **WHEN** the user asks Copilot for a review plan
- **THEN** Copilot's `start_review` payload includes parameters that align with the chunked review philosophy (e.g., specific scope, reasonable amount).
- **THEN** Copilot explains the plan in terms of "targeted packages" rather than a monolithic task.