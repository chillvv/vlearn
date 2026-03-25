## ADDED Requirements

### Requirement: Canonical Tag Dictionary
The system SHALL validate AI-generated mistake tags against a canonical project taxonomy before any create or update operation is executable.

#### Scenario: AI proposes existing taxonomy tags
- **WHEN** AI produces subject, knowledge point, ability, and error type tags that exist in the canonical dictionary
- **THEN** the draft is marked valid and can proceed to user confirmation.

#### Scenario: AI proposes unknown tag
- **WHEN** AI produces any tag not present in the canonical dictionary
- **THEN** the system blocks direct execution and provides mapped alternatives for user selection.

### Requirement: User-Editable Tag Draft
The system SHALL allow users to edit AI-proposed tags before final confirmation of mistake save or update actions.

#### Scenario: User adjusts one tag
- **WHEN** user edits a proposed knowledge point or error type in the draft card
- **THEN** the draft updates in place and is revalidated against canonical taxonomy rules.

### Requirement: Controlled Tag Extension Sync
The system MUST support approved new-tag proposals and synchronize approved tags into project taxonomy definitions.

#### Scenario: New tag is approved
- **WHEN** an unknown tag proposal is approved by product taxonomy rules
- **THEN** the system records the new mapping version and exposes the tag in future AI proposals and filters.

#### Scenario: New tag is not approved
- **WHEN** a tag proposal fails governance rules
- **THEN** the system retains existing taxonomy and requires user to choose valid tags.
