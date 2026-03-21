# dashboard-optimization Specification

## Purpose
TBD - created by archiving change web-refactor. Update Purpose after archive.
## Requirements
### Requirement: Dashboard Display
The system SHALL display accurate key statistics fetched from the real backend and handle loading/empty states cleanly.

#### Scenario: View Dashboard while loading
- **WHEN** the dashboard is fetching data
- **THEN** system displays skeleton loaders instead of broken layouts or mock data

#### Scenario: View Dashboard with real data
- **WHEN** data fetch is complete
- **THEN** system displays accurate total weaknesses, mistakes, and dynamically rendered subject distribution cards (only for English and Programming)

