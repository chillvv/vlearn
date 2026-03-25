## ADDED Requirements

### Requirement: Canonical Question Payload
The system SHALL transform every AI-generated exercise into a canonical payload that includes question type, structured content blocks, answer schema, and render metadata before persistence.

#### Scenario: Normalize generated question
- **WHEN** AI generation returns question content for any supported exercise type
- **THEN** the system produces a canonical payload with required fields and persists it as the primary render source

### Requirement: Validation Before Persistence
The system SHALL validate canonical payloads against a schema and SHALL tag each record with validation status.

#### Scenario: Validation succeeds
- **WHEN** normalized payload passes schema validation
- **THEN** the system stores validation status as valid and allows normal render flow

#### Scenario: Validation fails
- **WHEN** normalized payload fails schema validation
- **THEN** the system stores validation status as invalid, preserves raw AI response, and enables fallback render mode

### Requirement: Multi-Type Coverage
The system SHALL support normalization for multiple-choice, fill-in-blank, short-answer, sentence-correction, and mixed-format items.

#### Scenario: Non-choice question normalization
- **WHEN** AI returns a fill-in-blank or short-answer item
- **THEN** the normalization pipeline maps it into the canonical payload without forcing option arrays
