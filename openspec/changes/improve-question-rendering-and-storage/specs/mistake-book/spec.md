## MODIFIED Requirements

### Requirement: Mistake List View
The system SHALL present the mistake book as a hierarchical taxonomy tree based on subjects and hard-core knowledge points, and each mistake entry SHALL render from canonical structured payload fields instead of raw plain-text option strings.

#### Scenario: User navigates mistake book
- **WHEN** user opens the Mistake Book
- **THEN** the user sees a tree structure (e.g., English -> Syntax -> Relative Clauses) indicating the count of mistakes per node.

#### Scenario: Render malformed wrong-question entry
- **WHEN** a mistake record has invalid normalized payload status
- **THEN** the system displays a safe fallback card and prevents broken option layout in the list
