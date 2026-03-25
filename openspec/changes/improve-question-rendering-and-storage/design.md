## Context

Current exercise and mistake rendering flows mix raw model text, escaped line breaks, and loosely formatted option fields. This causes visual artifacts in wrong-question cards and unstable rendering behavior when question types differ from multiple-choice. The system also lacks a strict contract between AI generation, database persistence, and frontend rendering, so malformed output leaks directly to users.

## Goals / Non-Goals

**Goals:**
- Define a canonical question payload that all AI-generated exercises must map to before storage.
- Persist both raw AI output and normalized structured blocks to support traceability and reliable rendering.
- Enable one shared renderer that handles multiple-choice, fill-in-blank, short answer, correction, and mixed-format exercises.
- Add fallback behavior so malformed content degrades gracefully instead of breaking UI.

**Non-Goals:**
- Rebuilding the full visual design system or global layout.
- Replacing the AI provider model stack.
- Migrating historical records to perfect structure in one release.

## Decisions

1. Canonical payload with block-based content model  
   - Decision: Introduce a type-discriminated payload (questionType + contentBlocks + answerSchema + renderHints) as the source of truth for rendering.  
   - Rationale: A block model supports heterogeneous question formats while keeping UI logic unified.  
   - Alternative considered: Keep per-question-type tables and renderer branches; rejected due to rapid growth of duplicated logic.

2. Two-layer persistence (raw + normalized)  
   - Decision: Store raw AI response alongside normalized JSON fields and validation status.  
   - Rationale: Raw text enables audit/debug and prompt tuning; normalized data ensures deterministic UI rendering.  
   - Alternative considered: Store normalized only; rejected because parsing regressions become hard to diagnose.

3. Validation and normalization at write boundary  
   - Decision: Enforce schema validation immediately after AI generation and before persistence; reject or mark invalid payloads with fallback strategy.  
   - Rationale: Prevents inconsistent records and isolates bad generations early.  
   - Alternative considered: Validate only at render time; rejected because invalid data would accumulate in storage.

4. Shared renderer with type adapters  
   - Decision: Build a single rendering pipeline that reads canonical blocks and delegates only minimal type-specific interactions.  
   - Rationale: Keeps UI consistency and reduces divergence between pages such as wrong-question list and exercise detail.
   - Alternative considered: Keep page-local renderers; rejected for maintenance overhead and inconsistent behavior.

## Risks / Trade-offs

- [Normalization misses edge patterns] → Add validation error taxonomy and iterative parser rules with sampled replay tests.
- [Payload schema grows too quickly] → Version the schema and enforce backward-compatible readers.
- [Fallback hides generation quality issues] → Surface invalid-rate metrics and admin diagnostics dashboards.
- [Partial migration complexity] → Use read-time compatibility adapter for legacy records during transition.

## Migration Plan

1. Add new normalized payload fields and validation status fields in database schema.
2. Release write-path normalization for newly generated exercises and wrong-question entries.
3. Enable shared renderer behind feature flag for selected pages.
4. Add read adapter for legacy records and progressively backfill high-frequency records.
5. Remove old ad-hoc rendering branches after stability metrics meet threshold.

## Open Questions

- Should legacy records be backfilled synchronously on read or via background batch jobs only?
- What invalid-rate threshold should trigger automatic prompt rollback?
- Which fields are mandatory for analytics versus optional for rendering hints?
