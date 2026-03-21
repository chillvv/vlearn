## ADDED Requirements

### Requirement: Knowledge Tree Browsing
The system SHALL dynamically render the knowledge tree based on data fetched from `knowledgeTreeApi` and handle empty nodes gracefully.

#### Scenario: Browse Dynamic Knowledge Tree
- **WHEN** user navigates through the knowledge universe
- **THEN** system renders modules, chapters, and skills based on the hierarchical data returned from Supabase

#### Scenario: View Concept Capsule with Real Mistakes
- **WHEN** user opens a concept capsule detail page
- **THEN** system displays only real mistakes associated with that specific knowledge node, without fallback to mock variations