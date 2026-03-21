## ADDED Requirements

### Requirement: Tinder-like Swipe UI
The system SHALL present daily review mistakes as flashcards that the user can swipe left ("Again") or right ("Easy").

#### Scenario: User reviews a card
- **WHEN** user views the back of a flashcard
- **THEN** user can swipe left to schedule the card for tomorrow, or right to schedule it further in the future according to the Ebbinghaus curve.

### Requirement: Ebbinghaus Spaced Repetition
The system SHALL schedule the next review date based on the user's swipe action and previous review history.

#### Scenario: User swipes left 3 times
- **WHEN** user swipes left on a card for the 3rd time
- **THEN** the system marks the mistake as a "Stubborn Mistake" in the Hub view.