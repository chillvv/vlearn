## ADDED Requirements

### Requirement: Display Knowledge at Hub
The system SHALL display a "Tips & Tricks" (提分锦囊) card at the top of the node view, containing AI-generated tips for the specific mistake category.

#### Scenario: User opens a leaf node
- **WHEN** user clicks on a leaf node (e.g., "Relative Clauses")
- **THEN** the system displays a collapsible knowledge card at the top of the page.

### Requirement: List Mistakes in Hub
The system SHALL display the list of all mistakes belonging to the current node directly below the knowledge card.

#### Scenario: User views mistakes
- **WHEN** the user is on the Hub view
- **THEN** the system lists all mistakes tagged with the current node's category.
