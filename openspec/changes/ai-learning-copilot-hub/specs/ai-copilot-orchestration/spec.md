## ADDED Requirements

### Requirement: Intent-to-Action Planning
The system SHALL translate user learning intents into structured action proposals that separate explanatory guidance from executable operation payloads.

#### Scenario: Solve and save request
- **WHEN** user submits a mistake image or text and asks for explanation plus upload
- **THEN** the system returns (1) step-by-step solution content and (2) a structured draft action payload for mistake creation.

#### Scenario: Review recommendation request
- **WHEN** user asks what to review today
- **THEN** the system returns a ranked review proposal with topic focus, amount, and launch parameters.

### Requirement: Recommend-First Execution Policy
The system MUST require explicit user confirmation before executing any proposed operation.

#### Scenario: User receives upload proposal
- **WHEN** the user has not confirmed the draft card
- **THEN** no database write is executed.

#### Scenario: User confirms proposal
- **WHEN** the user taps the confirmation action on the card
- **THEN** the corresponding operation is executed and a receipt is returned.

### Requirement: Risk-Tiered Confirmation
The system SHALL enforce secondary confirmation for high-risk operations and single confirmation for low-risk operations.

#### Scenario: High-risk deletion
- **WHEN** user triggers delete or destructive bulk update
- **THEN** the system requests an additional explicit confirmation before execution.

#### Scenario: Low-risk save
- **WHEN** user confirms creation or non-destructive label update
- **THEN** the system executes after one confirmation step.
