## Context

The product already has working mistake CRUD, review mode, drill mode, and streaming AI responses, but these capabilities are fragmented across separate pages and manual setup flows. The target UX is an AI Learning Copilot that acts as a task gateway: users express intent once, receive a structured plan, confirm, and execute directly.  
Key constraints:
- Default policy is recommend-first, then execute.
- High-risk actions require explicit secondary confirmation.
- Copilot must remain learning-domain only and avoid general chitchat behavior.
- AI-generated tags must align with the project taxonomy and support controlled extension.

## Goals / Non-Goals

**Goals:**
- Build an intent-to-action orchestration model for solve/save/review/practice flows.
- Standardize chat-native action cards and operation receipts.
- Add deterministic guardrails for execution safety and non-chitchat scope.
- Ensure tag draft/edit/confirm flows always validate against canonical taxonomy mappings.
- Support direct deep-link entry into preconfigured active review and drill sessions.

**Non-Goals:**
- Replacing all existing pages with a single chat-only UI.
- Fully autonomous execution without user confirmation.
- Introducing open-domain assistant behavior.
- Redesigning core spaced-repetition algorithms in this phase.

## Decisions

### Decision 1: Two-layer AI response contract (Explanation + Action JSON)
- **Choice:** AI outputs human-readable explanation plus machine-readable action payload.
- **Rationale:** Preserves educational readability while enabling deterministic execution.
- **Alternative considered:** Free-form text parsing only; rejected due to low reliability and action ambiguity.

### Decision 2: Explicit action state machine
- **Choice:** Use fixed states: `UNDERSTAND -> PROPOSE -> CONFIRM -> EXECUTE -> RECEIPT`.
- **Rationale:** Makes UX predictable, supports risk gating, and simplifies auditability.
- **Alternative considered:** Direct execution after intent detection; rejected due to safety and trust concerns.

### Decision 3: Risk-tiered execution guardrails
- **Choice:** Define low-risk and high-risk action classes with mandatory secondary confirmation for high-risk actions.
- **Rationale:** Enables efficient operation while preventing destructive errors.
- **Alternative considered:** Universal confirmation for all actions; rejected due to interaction friction.

### Decision 4: Canonical tag governance with sync versioning
- **Choice:** Introduce a canonical tag dictionary and mapping version checked at draft-confirm and write time.
- **Rationale:** Prevents taxonomy drift across AI outputs, user edits, and existing mistake-book filters.
- **Alternative considered:** Permit free-form tags and normalize later; rejected because it breaks retrieval/filter consistency.

### Decision 5: Deep-link launch snapshots for review/drill
- **Choice:** AI confirms a plan and generates a launch snapshot consumed by review/drill routes to enter active mode directly.
- **Rationale:** Delivers “no-form, one-click start” experience while reusing existing page logic.
- **Alternative considered:** Bypass pages and run exercises inside chat; deferred to future phases due to complexity.

## Risks / Trade-offs

- **[Risk] Action JSON format drift across model outputs** → Mitigation: strict schema validation, fallback template repair, and non-executable downgrade when invalid.
- **[Risk] Tag mismatch between AI output and taxonomy** → Mitigation: canonical dictionary lookup + suggested substitutes + user edit before confirm.
- **[Risk] Overly strict non-chitchat policy hurts perceived friendliness** → Mitigation: polite redirect templates with immediate actionable buttons.
- **[Risk] Cross-page state desync after AI-triggered writes** → Mitigation: operation receipt IDs, optimistic update boundaries, and forced refresh on launch.
- **[Risk] Confirmation fatigue** → Mitigation: low-risk single confirm, high-risk double confirm only.

## Migration Plan

1. Add action response schema and card renderer without changing existing manual pages.
2. Integrate solve-and-save flow with draft editing and confirmation, then connect to existing mistake create/update APIs.
3. Add review/drill launch snapshots and route entry adapters for direct active mode start.
4. Introduce tag governance dictionary, mapping version checks, and sync workflows.
5. Enable non-chitchat onboarding chips and out-of-scope redirect behavior.
6. Roll out behind a feature flag for selected users, then promote after telemetry stability.

Rollback strategy:
- Disable Copilot feature flag to return to existing manual navigation and forms.
- Preserve all data writes through existing APIs to avoid data migration rollback complexity.

## Open Questions

- Should approved new tags be available immediately for all users or staged per tenant/environment?
- What telemetry thresholds should auto-disable direct execution and force “proposal-only mode”?
- Should operation receipts be persisted in a dedicated table or embedded in existing mistake activity logs?
