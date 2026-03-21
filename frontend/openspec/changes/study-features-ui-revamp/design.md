## Context

The UI/UX for the Error Hub, Review Center, and Targeted Drill needs a major overhaul to provide a more structured, immersive, and AI-powered learning experience. The new design requires complex UI components (Masonry grids, 3D flip cards, drawers) and interactions (keyboard shortcuts, real-time feedback animations) that are not currently present in the system.

## Goals / Non-Goals

**Goals:**
- Implement a structured, 3-column masonry/grid layout for the Error Hub with L2/L3 nested tag components and a slide-out drawer.
- Create an immersive, distraction-free Review Center using CSS 3D transforms for flashcards and global keyboard shortcuts.
- Build a split-screen Targeted Drill interface with stateful UI (skeleton loading, interactive block cards, instant feedback animations).

**Non-Goals:**
- Changes to the underlying backend APIs or database schema (this UI revamp assumes the necessary data is already available or will be provided by existing endpoints).
- Implementing the actual AI generation logic (this focuses purely on the UI/UX frontend implementation, including loading states and feedback display).

## Decisions

- **Error Hub Layout**: We will use CSS Grid/Columns or a lightweight Masonry layout component for the 3-column card arrangement to ensure responsive behavior without heavy JS calculation.
- **Review Center Immersion**: We will introduce a `hideNav` state or layout wrapper to the main application shell to hide the global sidebar/navigation when the Review Center is active.
- **3D Flashcards**: The flip animation will be implemented using pure CSS (`transform-style: preserve-3d`, `backface-visibility: hidden`, and `transform: rotateY()`) for optimal performance and smooth 60fps animations.
- **Keyboard Shortcuts**: We will implement a custom React hook (e.g., `useKeyPress`) attached to the `window` object to listen for Spacebar, 1, 2, and 3 keys during the Review Center session.
- **Targeted Drill State Management**: The practice component will use a finite state machine approach (States: `loading/generating` -> `idle` -> `submitted/feedback`) to cleanly handle the transition from the AI skeleton screen to the interactive quiz and finally the feedback view.

## Risks / Trade-offs

- **Risk: Masonry Layout Performance**: Rendering many nested tags inside a complex Masonry layout could cause reflows. -> **Mitigation**: Use pure CSS multi-column layouts where possible instead of JS-based Masonry to minimize performance hits.
- **Risk: Global Keyboard Shortcut Conflicts**: Shortcuts in the Review Center might conflict with other browser actions or input fields. -> **Mitigation**: Ensure keyboard event listeners check that the `event.target` is not an input/textarea and only attach listeners when the Review Center is mounted.
- **Risk: 3D Animation Jitter**: Flip animations can look glitchy on some mobile browsers. -> **Mitigation**: Add `will-change: transform` and hardware acceleration hints (`translateZ(0)`) to the card elements.