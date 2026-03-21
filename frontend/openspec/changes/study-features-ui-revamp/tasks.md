## 1. Setup & Shared Components

- [x] 1.1 Create `Drawer` component for right-side slide-out panels
- [x] 1.2 Create `BlockCard` component for multiple-choice options with hover/active states
- [x] 1.3 Create reusable AI tip card and skeleton loading components

## 2. Error Hub (错题枢纽)

- [x] 2.1 Implement Masonry/Grid layout container for a maximum of 3 columns
- [x] 2.2 Create L2 group title component and L3 pill tag component (with mastery status styling: red/badge vs green/checkmark)
- [x] 2.3 Integrate `Drawer` to open on unmastered L3 tag click, displaying folded AI tips and error question lists

## 3. Review Center (复习中心)

- [x] 3.1 Implement a `FullScreenLayout` wrapper that hides the global navigation/sidebar and displays only the top progress bar and exit button
- [x] 3.2 Create the `FlipCard3D` component supporting pure CSS 3D flip animations with distinct Front (question) and Back (answer, AI tip, buttons) states
- [x] 3.3 Implement custom keyboard shortcut hook (`useKeyPress`) to listen for Spacebar and number keys 1, 2, 3
- [x] 3.4 Wire up state management and connect the spaced-repetition action buttons (Forgot, Vague, Mastered)

## 4. Targeted Drill (专项训练)

- [x] 4.1 Implement the split-screen layout component (1/3 reference section, 2/3 drill section)
- [x] 4.2 Build the state machine to handle the AI skeleton generation state, showing a 1-2s premium glowing animation
- [x] 4.3 Implement specific question type UIs (Block cards for choice, styled inputs for fill-in-the-blanks)
- [x] 4.4 Add immediate visual feedback upon submission (green highlight/fireworks for correct, red highlight/expand AI parsing for incorrect)
- [x] 4.5 Add the discrete "Issue with question/parsing?" anti-hallucination report button to the bottom right of the question container
