## Why

The current UI/UX for the learning modules (Error Hub, Review Center, and Targeted Drill) lacks structure, immersion, and a modern, "AI-powered" feel. To provide a better learning experience, we need to revamp these interfaces to be cleaner, more structured (like a "knowledge hub"), and highly focused. This change will improve user engagement, reduce cognitive load during study sessions, and highlight the platform's intelligent AI capabilities.

## What Changes

- **Error Hub (错题枢纽)**: Redesigned into a structured, breathable dashboard with a Masonry/Grid layout (max 3 columns). Introduces clear L2 (sub-group) and L3 (pill tags) hierarchies for knowledge points, replacing flat lists. Adds a right-side drawer for quick access to specific error details.
- **Review Center (复习中心)**: Transformed into an immersive, full-screen 3D flashcard experience. Removes all distractions (hidden side menus), introduces smooth 3D flip animations, and integrates AI tips directly into the answer state with clear spaced-repetition action buttons.
- **Targeted Drill (专项训练)**: Upgraded to a customized, AI-powered split-screen interface (1/3 reference, 2/3 drill). Adds an AI generation skeleton screen, block-card options, instant visual feedback (fireworks for correct, AI parsing for wrong), and an anti-hallucination reporting mechanism.

## Capabilities

### New Capabilities
- `error-hub-ui`: The new dashboard UI for managing and navigating error records by knowledge points.
- `review-center-ui`: The immersive, full-screen 3D flashcard review experience.
- `targeted-drill-ui`: The AI-powered, split-screen targeted practice interface with instant feedback and generation states.

### Modified Capabilities

- None.

## Impact

- **UI Components**: Significant additions of new UI components (Masonry grids, 3D Flip Cards, Skeleton loaders, Drawers, Block Cards).
- **Layouts**: Introduction of a new full-screen layout mode for the Review Center that hides the global navigation.
- **Interactions**: Complex state management for flashcard flipping, real-time feedback animations, and drawer toggling.
