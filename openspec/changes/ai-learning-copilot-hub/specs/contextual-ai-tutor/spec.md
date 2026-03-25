## MODIFIED Requirements

### Requirement: Localized Chat Interface
The system SHALL provide a contextual AI learning copilot anchored to mistake-focused workflows, with quick task chips and action cards instead of free-form generic chat.

#### Scenario: User opens mistake-focused workspace
- **WHEN** user enters mistake detail, mistake list, review, or drill workspace
- **THEN** the AI copilot panel is available with guided quick actions for solve, save, review, and practice tasks.

### Requirement: Prompt Injection Protection
The system SHALL restrict AI responses and executable actions to learning-domain requests related to mistakes, review, and practice.

#### Scenario: User asks out-of-scope question
- **WHEN** user asks for non-learning content such as jokes or unrelated life topics
- **THEN** the AI declines the request and redirects the user to a valid learning action with an executable button.

## ADDED Requirements

### Requirement: Recommend-Then-Execute Flow
The system MUST present an explicit recommendation card and wait for user confirmation before executing any learning operation.

#### Scenario: User requests practice plan
- **WHEN** user asks the AI to choose what to practice today
- **THEN** the AI returns a preconfigured practice recommendation card and does not start the session until user confirms.
