## ADDED Requirements

### Requirement: Global Data Source Validation
The system SHALL NOT display any hardcoded mock questions or knowledge nodes. All data MUST be fetched from the Supabase database.

#### Scenario: View Data Pages (Empty Database)
- **WHEN** user visits Knowledge Base or Dashboard and the database is empty
- **THEN** system displays a "No Data" empty state with a prompt to add new mistakes

#### Scenario: View Data Pages (Populated Database)
- **WHEN** user visits Knowledge Base or Dashboard
- **THEN** system displays the actual data retrieved from the backend API