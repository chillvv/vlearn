## MODIFIED Requirements

### Requirement: Review Session Management
系统必须确保复习状态的准确同步。在用户退出复习（无论是正常完成还是中途退出）时，系统不仅要清除本地持久化的 `active-review-task`，还必须立即使关联的 React Query 缓存（如 `questions` 列表查询）失效，以防止下次进入时重复加载已完成的题目。

#### Scenario: Exiting a review session early
- **WHEN** the user clicks "退出" during an active review session
- **THEN** The system prompts for confirmation if there are unfinished items.
- **THEN** Upon confirmation, the system clears the local storage persisted task, resets component state (cards, currentIndex, status), and invalidates react-query cache for `questions` to ensure the next session pulls fresh data.