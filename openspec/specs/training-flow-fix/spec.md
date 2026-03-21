# training-flow-fix Specification

## Purpose
TBD - created by archiving change web-refactor. Update Purpose after archive.
## Requirements
### Requirement: Focused Training Flow Execution
The system SHALL execute the training flow by passing real user weakness context to the AI prompt and robustly handle the AI JSON response.

#### Scenario: Initiate Training from Weakness
- **WHEN** user starts a drill for a specific topic
- **THEN** system passes the exact topic to the AI generation prompt

#### Scenario: Handle Malformed AI Response
- **WHEN** AI returns a malformed JSON string for the training questions
- **THEN** system catches the error, displays a friendly toast notification, and allows the user to retry without crashing the page

