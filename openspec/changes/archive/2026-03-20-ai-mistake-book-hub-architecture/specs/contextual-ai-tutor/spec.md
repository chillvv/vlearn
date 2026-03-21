## ADDED Requirements

### Requirement: Localized Chat Interface
The system SHALL provide a contextual chat interface only on the individual Mistake Detail page, not as a global app feature.

#### Scenario: User opens mistake detail
- **WHEN** user views a specific mistake
- **THEN** a localized chat input appears at the bottom with quick-reply chips.

### Requirement: Prompt Injection Protection
The system SHALL use system prompts to restrict the AI from answering questions unrelated to the specific mistake being viewed.

#### Scenario: User asks about weather
- **WHEN** user asks the AI "What is the weather today?"
- **THEN** the AI politely declines and redirects the user back to the mistake topic.