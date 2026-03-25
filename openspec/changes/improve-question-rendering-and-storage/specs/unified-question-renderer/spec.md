## ADDED Requirements

### Requirement: Schema-Driven Rendering
The system SHALL render question content from canonical structured blocks rather than raw AI text fragments.

#### Scenario: Render normalized question card
- **WHEN** a wrong-question or exercise detail page loads a normalized payload
- **THEN** the UI renders title, stem, options, and explanation from structured block fields with consistent spacing and typography

### Requirement: Type-Adaptive Interaction
The system SHALL use one shared renderer with type adapters for answer interaction patterns across supported question formats.

#### Scenario: Render different question types
- **WHEN** consecutive exercises include multiple-choice, fill-in-blank, and short-answer items
- **THEN** the shared renderer keeps visual consistency while presenting appropriate input controls per type

### Requirement: Fallback Degradation
The system SHALL display a safe fallback view when normalized payload is invalid or incomplete.

#### Scenario: Fallback on invalid payload
- **WHEN** validation status is invalid for a question record
- **THEN** the UI shows a readable fallback card with minimal required content and no layout break
