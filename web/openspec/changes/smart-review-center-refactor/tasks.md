# Implementation Tasks

## 1. UI & Data Flow Overhaul (`ReviewModePage.tsx`)
- [x] Remove the top static information section ("本轮目标", "预期收益").
- [x] Remove the 7-day activity chart to declutter the page.
- [x] Introduce a Subject Filter toggle (e.g., "英语" vs "C语言") at the top of the 'ready' state. Ensure the filter drives all subsequent data queries.
- [x] Redesign the 'ready' state UI to display multiple "Task Packages" (AI 分包卡片), each with a specific theme (e.g., "高频易错突击", "近期遗忘抢救"), a fixed question count (10-15), and an independent "Start" button.

## 2. Smart Chunking & Queries (`queries/questions.ts` & `ReviewModePage.tsx`)
- [x] Update `useQuestionsCountQuery` or create a new query `useReviewChunksQuery` to fetch the counts for different chunking strategies (e.g., `due`, `stubborn`) based on the selected subject.
- [x] Modify `startReview` in `ReviewModePage.tsx` to accept chunk parameters (`strategy`, `amount`) from the selected Task Package card.
- [x] Pass the chunk parameters to `runReviewPlanner` so it generates exactly the 10-15 questions defined for that chunk.

## 3. Session Management & Cache Invalidation Bug Fix
- [x] Modify the `handleExit` (or equivalent exit session logic) in `ReviewModePage.tsx`.
- [x] Ensure that when the user exits a session (whether finished or partially done), `queryClient.invalidateQueries` is called immediately for the `questions` and `dueCount` keys.
- [x] Clear the local storage cache (`active-review-task`) upon exit to guarantee a fresh fetch on the next 'ready' screen load.

## 4. Copilot Integration Updates (`api.ts`, `copilotMode.ts`, `CopilotHandoffDialog.tsx`)
- [x] Update `AI_COPILOT_PROMPT` in `api.ts`: Modify the `start_review` payload definition to require `subject`, encourage small `amount` (10-20), and introduce the `strategy` concept (e.g., `due_rescue`, `stubborn_focus`). Enforce that subjects are NOT mixed.
- [x] Add explicit instructions in the prompt to explain review plans as "targeted packages" (专项任务包).
- [x] Update `ReviewPresetLike` in `copilotMode.ts` to include the new `strategy` field.
- [x] Adjust `CopilotHandoffDialog.tsx` to display the specific `subject` and `strategy` on the Handoff Card.
- [x] Ensure the Handoff payload correctly passes the `subject` and `strategy` to the Review Center when navigating.
