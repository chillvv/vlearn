## Context

The current Mistake Book and Knowledge Base are separate entities. We are pivoting to an "AI Copilot" and "Node as a Hub" model. This means building a unified view for reviewing, managing, and practicing specific knowledge points. Additionally, we are transitioning from standard chat-based LLM interactions to strict GUI-driven interactions where AI generates structured data (JSON) rendered via React components.

## Goals / Non-Goals

**Goals:**
- Implement a hierarchical 3-layer taxonomy tree UI for Mistake Book.
- Integrate a collapsible AI "Tips & Tricks" card at the top of the leaf node views.
- Build a Tinder-like Swipe UI for flashcard reviews connected to Ebbinghaus spacing logic.
- Replace unstructured chat interactions with structured API calls (JSON mode) for Variant Generation.
- Embed contextual chat only within individual mistake detail views.
- Apply a Minimalist SaaS UI system (Flat Design, Plus Jakarta Sans, Cyan/Green primary colors).

**Non-Goals:**
- Do not build a standalone Knowledge Base or textbook reading feature.
- Do not implement a global chat interface.

## Decisions

1. **Design System & UI**:
   - **Rationale**: Based on UI/UX Pro Max analysis, an EdTech SaaS requires a clean, minimal, professional look.
   - **Details**:
     - Font: `Plus Jakarta Sans`
     - Style: Flat Design, minimal shadows, clean lines, bold colors.
     - Colors: `#0891B2` (Cyan) for primary actions, `#22C55E` (Green) for correct/success states.
     - Interaction: Micro-interactions (50-150ms transitions), Tinder-like swipe gestures for flashcards.

2. **AI Integration Strategy (GUI over CUI)**:
   - **Rationale**: Users want fast results, not conversation.
   - **Details**: Use LLM APIs with strict `response_format: { type: "json_object" }` for OCR extraction and Variant Generation. The frontend will map this JSON directly to UI components (e.g., selectable buttons for A/B/C/D).

3. **Data Structure (Taxonomy)**:
   - **Rationale**: We need a 3-layer tag system to power the tree.
   - **Details**: `Subject -> Category -> Node`. Each Mistake row will contain references to these layers. The `Node` entity will act as the Hub, storing the AI-generated "Tips & Tricks" summary.

4. **Review Algorithm**:
   - **Rationale**: Ebbinghaus needs structured scheduling.
   - **Details**: Simple buckets (1 day, 3 days, 7 days, 15 days, 30 days). Swiping left ("Again") resets to 1 day. Swiping right ("Easy") moves to the next bucket. If a card hits the 1-day bucket 3 times consecutively, mark as `stubborn: true`.

## Risks / Trade-offs

- **Risk: AI Hallucination in Variant Generation** -> Mitigation: Implement a prominent "Report Error/Feedback" button on every AI-generated question. Use JSON Schema validation on the backend before returning data to the frontend.
- **Risk: Swipe UI complexity on Desktop** -> Mitigation: Add keyboard shortcuts (Left Arrow / Right Arrow) and visible buttons as fallbacks for the swipe gestures on non-touch devices.
