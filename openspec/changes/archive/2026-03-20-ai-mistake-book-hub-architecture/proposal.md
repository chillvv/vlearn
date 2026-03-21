## Why

Users don't need a comprehensive encyclopedia for test preparation; they need an efficient, personalized tool that provides immediate actionable insights ("提分锦囊/解题大招库"). The current separation of "Mistake Book" and "Knowledge Base" creates a disjointed experience. We need an AI Copilot approach that seamlessly integrates mistake recording, structured tagging, spaced repetition, and dynamic variant generation, maintaining a clean GUI while leveraging powerful AI capabilities under the hood.

## What Changes

- Implement "Node as a Hub" architecture: The Knowledge Base is no longer a separate section but integrated directly into the Mistake Book's leaf nodes (e.g., specific grammar rules or programming concepts).
- Enhance Mistake Input: Introduce an AI-driven rapid entry workflow (Camera/OCR -> AI structure tagging) with zero manual typing required.
- Overhaul Review Center: Replace list-based review with a Tinder-like Swipe UI Flashcard system (Swipe Left: Again, Swipe Right: Easy) integrated with Ebbinghaus spaced repetition.
- Overhaul Targeted Drill: Add a "Generate Variants" button within the Hub to dynamically generate structured variant questions via AI (using JSON output).
- Implement Contextual AI Chat: Add localized, context-aware AI chat restricted to specific questions, rather than a global open chat.

## Capabilities

### New Capabilities
- `node-as-a-hub`: The integrated knowledge and mistake view at the leaf node of the taxonomy tree.
- `ai-rapid-entry`: OCR and AI-driven automated structural tagging of new mistakes.
- `swipe-flashcards`: Ebbinghaus-based flashcard review system with swipe gestures.
- `dynamic-variants`: AI-powered generation of variant questions (Base, Context Swap, Complex Trap) using strict JSON output.
- `contextual-ai-tutor`: Prompt-injected local AI chat strictly bounded to explaining the current mistake.

### Modified Capabilities
- `mistake-book`: Transforming from a simple list into a multi-dimensional taxonomy tree.
- `knowledge-base`: Deprecated as a standalone module, converted into the top section of the Hub.

## Impact

- Frontend: Complete redesign to adopt a Minimalist SaaS look (Flat Design, Plus Jakarta Sans, Clean Cyan/Green scheme).
- Backend/API: Transition from plain text AI endpoints to strict JSON schema responses for variant generation and tagging.
- Database: Update schemas to support the 3-layer taxonomy, flashcard review states (e.g., "Stubborn Mistake" flags), and AI-generated "Tips/Tricks".