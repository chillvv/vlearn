## ADDED Requirements

### Requirement: Trigger Variant Generation
The system SHALL provide a "Generate Variants" button within the Hub view to create targeted practice questions.

#### Scenario: User requests variants
- **WHEN** user clicks "Generate Variants" in the Hub
- **THEN** the system requests 3 progressive variant questions (Base, Context Swap, Trap) from the AI.

### Requirement: Structured JSON Response
The system SHALL require the AI to output variant questions in a strict JSON format (Question, Options, Correct Answer, Explanation).

#### Scenario: AI returns JSON
- **WHEN** the AI generation completes
- **THEN** the system parses the JSON and renders it using interactive UI components (Buttons for options, etc.) instead of plain text.

### Requirement: Error Feedback
The system SHALL include a "Report Error" button for every AI-generated question.

#### Scenario: User reports hallucination
- **WHEN** user encounters a bad AI question and clicks "Report Error"
- **THEN** the system flags the question for review and removes it from the user's view.