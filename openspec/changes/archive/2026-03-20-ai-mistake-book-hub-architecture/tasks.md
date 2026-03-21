## 1. Schema & Data Structure

- [x] 1.1 Update `Mistake` database schema to support 3-layer taxonomy tags (`subject`, `category`, `node`).
- [x] 1.2 Update `Mistake` schema to include Ebbinghaus review fields (`next_review_date`, `interval`, `stubborn_flag`).
- [x] 1.3 Create `KnowledgeNode` schema for caching AI-generated "Tips & Tricks" per leaf node.

## 2. API & Backend Services

- [x] 2.1 Implement `/api/mistakes/upload` endpoint integrating OCR and AI structured JSON extraction.
- [x] 2.2 Implement `/api/mistakes/variants` endpoint forcing AI JSON mode output for 3-level variant generation.
- [x] 2.3 Implement `/api/review/swipe` endpoint to handle Left/Right swipe state transitions (Ebbinghaus logic).

## 3. UI System & Core Layout (Plus Jakarta Sans + Flat Design)

- [x] 3.1 Update global Tailwind config (fonts, cyan/green color palette, flat design shadows/borders).
- [x] 3.2 Create Mistake Book Tree View component (Left sidebar or main list).
- [x] 3.3 Create the Hub View component for leaf nodes (Top AI Tips card + Bottom Mistake list).

## 4. Input & Review Modules

- [x] 4.1 Build the Camera/Upload OCR UI component with loading states and confirmation list.
- [x] 4.2 Build the Tinder-like Swipe Flashcard component for the Review Center.

## 5. Practice & AI Chat Modules

- [x] 5.1 Build the dynamic variant question UI (JSON rendering to GUI buttons/inputs).
- [x] 5.2 Implement the Contextual AI Tutor chat component on the Mistake Detail page (with prompt injection safeguards).