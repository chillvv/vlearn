## ADDED Requirements

### Requirement: Immersive Full-Screen Layout
The system SHALL hide the global sidebar and navigation menus when entering the Review Center, showing only a top progress bar and an exit button.

#### Scenario: Entering the Review Center
- **WHEN** the user starts a review session
- **THEN** the main layout enters full-screen mode without sidebars, displaying only "Today's Progress X/Y" and an [✖] exit button at the top

### Requirement: 3D Flip Card Front State
The system SHALL display the original question centered on a large card with a distinct "Reveal Answer" button at the bottom.

#### Scenario: Viewing a new question
- **WHEN** the user is presented with a flashcard
- **THEN** the front of the card displays the question text in a large font (18px-24px) with a [Reveal Answer] button

### Requirement: 3D Flip Card Back State
The system SHALL smoothly flip the card in 3D to reveal the correct answer, the user's original wrong answer, an embedded AI tip card, and three spaced-repetition action buttons.

#### Scenario: Revealing the answer
- **WHEN** the user clicks [Reveal Answer] or presses the Spacebar
- **THEN** the card flips with a 3D animation to show the back state

#### Scenario: Viewing the back state details
- **WHEN** the card is in the back state
- **THEN** it displays the correct answer (green), original wrong answer (red cross), an AI tip card, and three bottom buttons: [Forgot/Wrong], [Vague], and [Mastered]

### Requirement: Global Keyboard Shortcuts
The system SHALL support keyboard shortcuts for interacting with the Review Center: Spacebar to flip, '1' for Forgot/Wrong, '2' for Vague, and '3' for Mastered.

#### Scenario: Using keyboard shortcuts
- **WHEN** the user presses '1', '2', or '3' while the card is in the back state
- **THEN** the system triggers the corresponding spaced-repetition action
