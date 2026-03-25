## MODIFIED Requirements

### Requirement: Structured JSON Response
The system SHALL require the AI to output variant questions in a strict schema-aware JSON format that includes question type, structured content blocks, answer model, and explanation fields compatible with canonical normalization.

#### Scenario: AI returns schema-valid payload
- **WHEN** the AI generation completes with a valid structured response
- **THEN** the system normalizes and renders the variants directly through shared schema-driven UI components

#### Scenario: AI returns malformed payload
- **WHEN** the AI generation response violates required schema fields
- **THEN** the system flags the payload as invalid, stores the raw response for diagnostics, and shows user-safe retry feedback
