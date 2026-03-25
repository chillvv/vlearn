## Why

The current workflow still depends on users navigating separate pages and manually configuring review/practice settings, which creates decision fatigue and increases drop-off to external AI tools. We need an intent-driven AI Learning Copilot that can analyze mistakes, prepare executable plans, and guide users to direct actions while preserving strict learning-only boundaries.

## What Changes

- Introduce an AI Copilot orchestration layer that converts user intent into structured, confirmable actions instead of free-form chat.
- Add action cards in chat for mistake solve-and-save, label editing confirmation, review plan generation, and one-click drill launch.
- Enforce a “recommend first, execute on confirmation” policy with mandatory double-confirmation for high-risk operations.
- Add tag governance and synchronization rules so AI-generated labels always align with the project’s mistake taxonomy and can safely evolve with approved new tags.
- Support direct deep-link navigation into active review/drill sessions preconfigured by AI (skip manual setup forms).

## Capabilities

### New Capabilities
- `ai-copilot-orchestration`: Intent parsing, action planning, confirmation flow, and execution handoff for learning tasks.
- `mistake-tag-governance-sync`: Canonical tag dictionary, AI label validation, user-adjustable tag drafts, and sync-back to project taxonomy.

### Modified Capabilities
- `contextual-ai-tutor`: Expand from local Q&A into strict non-chitchat learning copilot behavior with operation proposals and guardrails.
- `mistake-book`: Support AI-assisted CRUD and tag updates with confirmation and traceable synchronization to taxonomy rules.

## Impact

- Frontend: Add a persistent Copilot panel experience, action card renderer, confirmation dialogs, and direct route entry states for review/practice pages.
- AI integration: Move from pure text completion to structured action JSON + explanatory text response contracts.
- Data model: Add or extend metadata for action drafts, operation receipts, and taxonomy versioning/mapping.
- Product behavior: Establish explicit risk tiers for actions and non-chitchat enforcement across onboarding, empty state, and out-of-scope prompts.
