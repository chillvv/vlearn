## 1. Global Setup and Subject Focus

- [x] 1.1 Update `src/app/lib/subjects.ts` (or equivalent configuration) to restrict available subjects to "英语" and "编程" only.
- [x] 1.2 Audit and remove references to "数学", "物理", "化学" across global filters and state contexts.

## 2. API Robustness Improvements

- [x] 2.1 Enhance JSON parsing logic in `src/app/lib/api.ts` (specifically `chatApi`) to gracefully handle malformed AI responses.
- [x] 2.2 Add error boundaries or toast notifications for failed API requests to improve user feedback.

## 3. Knowledge Universe Refactoring

- [x] 3.1 Remove `mockModulesData` from `KnowledgeUniversePage.tsx`.
- [x] 3.2 Implement `useEffect` to fetch real knowledge tree data using `knowledgeTreeApi.getTree()`.
- [x] 3.3 Create a "No Data" empty state UI for the Knowledge Universe prompting users to add mistakes.
- [x] 3.4 Update the rendering logic to map the fetched Supabase tree structure to the existing UI components.

## 4. Knowledge Base (Mistake List) Refactoring

- [x] 4.1 Remove `KNOWLEDGE_DATA` mock from `KnowledgeBasePage.tsx`.
- [x] 4.2 Fetch real user mistakes using `questionsApi.getAll()` and group/filter them appropriately.
- [x] 4.3 Implement loading skeletons and empty states for the list view.

## 5. Concept Capsule Detail Refactoring

- [x] 5.1 Remove `MOCK_MISTAKES` and `METHODOLOGY` mock data from `KnowledgeDetailPage.tsx`.
- [x] 5.2 Fetch real knowledge node details and related questions based on the route parameter (node ID).
- [x] 5.3 Render the actual user summary and associated mistakes.

## 6. Dashboard Refactoring

- [x] 6.1 Ensure `statsApi.get()` correctly reflects data only for the allowed subjects ("英语", "编程").
- [x] 6.2 Fix UI layout issues on the Dashboard, ensuring loading states (Skeletons) look polished.
- [x] 6.3 Improve the "Recent Questions" empty state to be more visually appealing and encouraging.

## 7. Targeted Drill Fixes

- [x] 7.1 Update `TargetedDrillPage.tsx` to ensure it passes the correct `subject` and `topic` from the selected real knowledge node to the AI prompt.
- [x] 7.2 Implement robust fallback handling if the AI fails to generate the drill JSON properly.
