## MODIFIED Requirements

### Requirement: Mistake List View
The system SHALL preserve hierarchical mistake browsing while supporting AI-initiated direct operations on mistakes and labels from the copilot flow.

#### Scenario: User opens mistake book
- **WHEN** user navigates to the Mistake Book
- **THEN** the user sees the subject-category-node hierarchy and can enter AI-guided operations without leaving the workflow.

## ADDED Requirements

### Requirement: AI-Assisted Mistake CRUD
The system SHALL allow users to confirm AI-proposed create and update operations for mistake records, including tag and note fields.

#### Scenario: User confirms AI save draft
- **WHEN** user confirms a copilot draft for a new mistake
- **THEN** the system creates the mistake record and returns a success receipt in chat.

#### Scenario: User confirms AI label update
- **WHEN** user confirms a copilot suggestion to adjust mistake tags
- **THEN** the system updates the target record and refreshes visible hierarchy counts.

### Requirement: High-Risk Deletion Confirmation
The system MUST require secondary confirmation before deleting a mistake record through AI-assisted operations.

#### Scenario: User requests deletion
- **WHEN** user asks the AI to delete a mistake
- **THEN** the system shows a second confirmation step before executing deletion.
