## ADDED Requirements

### Requirement: Structured Grid Layout
The system SHALL display error records in a Masonry or CSS Grid layout with a maximum of 3 columns.

#### Scenario: Viewing the Error Hub
- **WHEN** the user navigates to the Error Hub
- **THEN** the layout displays cards in a structured grid with up to 3 large cards per row

### Requirement: L2 and L3 Knowledge Point Hierarchies
The system SHALL group knowledge points within a card into L2 sub-groups (e.g., "Clauses", "Non-finite verbs") and L3 pill tags under them.

#### Scenario: Viewing a category card
- **WHEN** the user views a card (e.g., "Grammar")
- **THEN** the card contains gray sub-titles for L2 groupings, and L3 pill tags for specific knowledge points below each sub-title

### Requirement: Mastery Status Indicators
The system SHALL style L3 pill tags based on mastery: red background/border with a red badge for unmastered items with errors, and green background/border with a checkmark for mastered items.

#### Scenario: Unmastered tag
- **WHEN** an L3 tag has pending errors
- **THEN** it displays with a red theme and a badge indicating the number of errors (e.g., 🔴 15)

#### Scenario: Mastered tag
- **WHEN** an L3 tag has no pending errors
- **THEN** it displays with a green theme and a checkmark (e.g., 🟢 ✓)

### Requirement: Drawer Interaction for Details
The system SHALL open a right-side drawer when a user clicks on an unmastered L3 pill tag, displaying the AI tips and the list of specific error questions.

#### Scenario: Clicking an error tag
- **WHEN** the user clicks a red L3 pill tag
- **THEN** a drawer slides out from the right containing the folded AI tips and the list of errors for that tag
