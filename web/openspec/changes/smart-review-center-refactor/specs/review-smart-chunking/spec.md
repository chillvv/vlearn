## ADDED Requirements

### Requirement: Review Smart Chunking
系统必须能够将待复习错题拆分为多个小型、独立的目标任务包（如 10-15 题/包），以降低用户的认知负担。

#### Scenario: Ready state rendering
- **WHEN** status is 'ready'
- **THEN** The UI displays a list of available review task packages (e.g., High-frequency mistakes, Due items) instead of a single massive count and start button.

#### Scenario: Starting a chunked task
- **WHEN** the user clicks "Start this task" on a specific chunk
- **THEN** The review session begins with a limited queue size (e.g., 15) defined by that chunk's parameters.

### Requirement: Review Subject Filter
用户必须能在复习中心选择特定的学科（英语或 C语言），以过滤任务包和待复习题目。

#### Scenario: Subject selection
- **WHEN** the user selects a subject toggle on the ready page
- **THEN** The displayed task packages and total due counts update to reflect only that subject's items.

## MODIFIED Requirements

### Requirement: Review Session Management
系统必须在复习过程中实时持久化进度，并在用户退出复习（无论是完成还是中途退出）时，彻底清理当前会话的缓存和相关 Query 状态，防止已复习题目重复出现。

#### Scenario: Exiting a review session early
- **WHEN** the user clicks "Exit and return to Review Center"
- **THEN** The system prompts for confirmation if there are unfinished items.
- **THEN** Upon confirmation, the system clears the local storage persisted task, resets component state (cards, currentIndex, status), and invalidates react-query cache for `questions` to ensure the next session pulls fresh data.

### Requirement: Copilot Review Handoff
AI 管家在生成复习计划动作（start_review）时，其输出必须与新的复习分包逻辑相匹配，并在提示词中强调“专项/分包”复习而非全量复习。

#### Scenario: Copilot generating review plan
- **WHEN** the user asks Copilot for a review plan
- **THEN** Copilot's `start_review` payload includes parameters that align with the chunked review philosophy (e.g., specific scope, reasonable amount).
- **THEN** Copilot explains the plan in terms of "targeted packages" rather than a monolithic task.