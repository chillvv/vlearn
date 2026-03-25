## Why

The current wrong-question presentation mixes raw AI output with loosely structured option data, causing unreadable and inconsistent UI across question types. We need a unified normalization, storage, and rendering strategy so all exercise formats remain clear, stable, and visually consistent.

## What Changes

- Introduce an AI output normalization contract that converts model responses into a canonical question payload before persistence.
- Add a type-aware content storage structure that separates raw generation, normalized blocks, and render metadata.
- Upgrade mistake list and practice UI to render normalized content blocks instead of ad-hoc plain text fields.
- Add resilient fallback rendering and validation for malformed AI output to prevent broken cards.
- Extend the same pipeline beyond multiple-choice to fill-in-blank, short answer, sentence correction, and mixed-format items.

## Capabilities

### New Capabilities
- `question-content-normalization`: Standardized parsing and transformation from AI response to canonical, type-aware question structure.
- `unified-question-renderer`: Shared UI renderer for normalized question blocks and answer choices across all supported question types.

### Modified Capabilities
- `mistake-book`: Store and display structured question payloads with render metadata and degradation fallback.
- `dynamic-variants`: Enforce structured output rules so generated variants are directly compatible with normalization and rendering contracts.

## Impact

- Frontend: Mistake list cards, exercise detail pages, and answer option components will move to schema-driven rendering.
- Backend/API: AI prompt rules and response validation layers will enforce structured, type-discriminated payloads.
- Database: Add/adjust JSON fields for normalized blocks, option arrays, answer mapping, and render state; preserve raw AI response for traceability.
