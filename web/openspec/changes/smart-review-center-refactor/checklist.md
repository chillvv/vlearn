# Acceptance Checklist

## UI & UX
- [ ] The "Review Center" home page no longer shows the "本轮目标" and 7-day chart.
- [ ] A Subject selector is prominently displayed.
- [ ] The home page displays 2-3 "Task Package" cards instead of a single "Start 148 questions" button.
- [ ] Each task package contains only 10-20 questions and a clear target (e.g., "近期遗忘").

## Data Flow & Cache
- [ ] Completing a task package correctly reduces the global "Due count".
- [ ] Exiting a review session midway accurately saves progress for the completed questions.
- [ ] Re-entering the review session immediately after an exit fetches a *new* list of questions (no endless loop bug).

## AI Copilot Integration
- [ ] Asking Copilot to "Start a review" results in a prompt that specifies a single subject and a limited amount of questions (e.g., 15).
- [ ] The Copilot handoff card explicitly mentions the strategy/chunk and the subject.
- [ ] Confirming the Copilot review plan correctly starts the review session with the specified parameters.
