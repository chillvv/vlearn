# subject-focus Specification

## Purpose
TBD - created by archiving change web-refactor. Update Purpose after archive.
## Requirements
### Requirement: Constrained Subject List
The system SHALL restrict all subject selection and filtering options globally to only "英语" (English) and "编程" (Programming).

#### Scenario: Select Subject in Dashboard
- **WHEN** user interacts with subject filters
- **THEN** only "英语" and "编程" are available as options

#### Scenario: Upload Mistake Subject Selection
- **WHEN** user is uploading a new mistake
- **THEN** the system only allows tagging the mistake under "英语" or "编程"

