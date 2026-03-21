## ADDED Requirements

### Requirement: Image Upload for Mistakes
The system SHALL allow users to upload images of their mistakes via a prominent camera/upload button.

#### Scenario: User uploads an image
- **WHEN** user taps the camera button and selects an image
- **THEN** the system shows a loading state "AI is analyzing..."

### Requirement: AI Structured Parsing
The system SHALL use AI OCR and LLM capabilities to parse the image into a structured JSON containing the question text, standard tags (3-layer taxonomy), and error reasons.

#### Scenario: AI parses the mistake
- **WHEN** the AI analysis completes
- **THEN** the system presents a confirmation list showing the extracted text and tags without requiring a chat interface.

### Requirement: One-click Save
The system SHALL provide a single button to save all parsed mistakes into the database.

#### Scenario: User confirms save
- **WHEN** user clicks "Save to Mistake Book"
- **THEN** the mistakes are stored and mapped to the taxonomy tree.