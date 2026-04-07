## MODIFIED Requirements

### Requirement: Copilot Review Handoff
AI 管家（Copilot）在生成复习计划（`start_review`）时，其内部 Prompt 和行为表现必须适配新的“分包复习”与“学科独立”理念。

#### 1. 修改 AI_COPILOT_PROMPT 中的 `start_review` 定义
在 `api.ts` 的 `AI_COPILOT_PROMPT` 中，更新 `start_review` 动作的 payload 定义及规则：
- 强调每次复习必须指定 `subject`（如“英语”或“C语言”），不要把学科混在一起。
- 强调“分包”概念，生成的 `amount` 应控制在 10~20 题以内，避免一次性生成上百题的任务。
- `preset` 中的 `scope` 或新增的 `strategy` 应对应复习中心的“智能分包”策略（如 `due_rescue` 近期遗忘抢救，`stubborn_focus` 顽固错题突击）。

**示例修改：**
```typescript
- start_review: 开始复习。payload必须包含: preset({ subject(必须明确指定单一学科，绝不混杂), strategy(due_rescue/stubborn_focus/all), amount(建议10-20题的轻量任务包), sortBy(nearestDue/lowestMastery/latestWrong) })。在给用户的回复中，应使用“分包任务”或“专项突击”等词汇，减轻用户的心理压力。
```

#### 2. 更新 CopilotHandoffDialog 的表现
在 `CopilotHandoffDialog.tsx` 或相关交互中，当用户确认 `start_review` 动作时：
- Handoff Card 应展示这是“一个包含 X 道题的特定学科复习包”。
- 点击“开始复习”后，携带 `subject` 和 `strategy` 参数跳转到复习中心。

#### Scenario: Copilot generating a targeted review chunk
- **WHEN** the user asks Copilot for a review plan (e.g., "帮我复习一下错题")
- **THEN** Copilot's `start_review` payload includes a specific `subject` (based on context or asks user), a limited `amount` (e.g., 15), and a chunking `strategy` (e.g., `due_rescue`).
- **THEN** Copilot explains the plan as a small, manageable task: "我为你准备了一个 C语言 的【近期遗忘抢救】任务包，共 15 题，做完这组今天就能轻松达标！"
- **THEN** The Handoff Card displays these specific parameters clearly.