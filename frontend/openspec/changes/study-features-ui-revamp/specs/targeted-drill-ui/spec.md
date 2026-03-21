## ADDED Requirements

### Requirement: Split-Screen Drill Layout
The system SHALL present a split-screen interface where the left 1/3 displays the original error question and knowledge points, and the right 2/3 displays the active drill interface.

#### Scenario: Viewing the drill interface
- **WHEN** the user is in a targeted drill session
- **THEN** the screen is split into a left reference section (1/3) and a right practice section (2/3)

### Requirement: AI Generation Skeleton State
The system SHALL display a premium skeleton screen or glowing animation with explanatory text while AI is generating variant questions.

#### Scenario: Generating questions
- **WHEN** the user initiates a targeted drill
- **THEN** the system shows a 1-2 second skeleton animation with text like "✨ AI is generating 3 personalized questions based on your weakness..." before revealing the questions

### Requirement: Block Card Options for Multiple Choice
The system SHALL use large block cards for multiple-choice options instead of standard radio buttons, with distinct hover and active/selected states.

#### Scenario: Selecting an option
- **WHEN** the user clicks an option block card
- **THEN** the border changes color and thickens to indicate the selection

### Requirement: Instant Feedback and AI Parsing
The system SHALL provide immediate visual feedback and AI parsing upon submission. Correct answers trigger green highlights and fireworks; incorrect answers trigger red marks and expand an AI explanation.

#### Scenario: Submitting a correct answer
- **WHEN** the user submits the correct answer
- **THEN** the option lights up green and a firework animation is played

#### Scenario: Submitting a wrong answer
- **WHEN** the user submits an incorrect answer
- **THEN** the option turns red and an AI explanation block expands immediately below it

### Requirement: Anti-Hallucination Feedback Mechanism
The system SHALL include a discrete button on every question allowing users to report errors in the AI-generated questions or explanations.

#### Scenario: Reporting a bad question
- **WHEN** the user notices an issue with the AI content
- **THEN** they can click the small "⚠️ Issue with question/parsing?" button in the bottom right corner to report it
