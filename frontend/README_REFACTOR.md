# AI Web Project Refactoring Guide

This project has been refactored to separate the Frontend (React/Vite) and Backend (Java Spring Boot) as requested.

## Architecture

- **Frontend**: React + TypeScript + Tailwind CSS (Vite)
  - Located in root directory (src/app)
  - UI Refactored: Sidebar navigation, Settings page, Subject-specific tags.
- **Backend**: Java Spring Boot 3.2
  - Located in `backend/` directory
  - Database: H2 (File-based, zero configuration)
  - AI Integration: Doubao (Volcengine Ark) API

## Prerequisites

- Node.js & npm
- JDK 17+
- Maven

## How to Run

### 1. Start the Backend (Java)

1. Navigate to the `backend` directory:
   ```bash
   cd backend
   ```
2. Update the API Key in `src/main/resources/application.properties`:
   ```properties
   ai.doubao.api-key=YOUR_ACTUAL_API_KEY
   ```
3. Run the application:
   ```bash
   mvn spring-boot:run
   ```
   The server will start at `http://localhost:8080`.

### 2. Start the Frontend (React)

1. Open a new terminal in the project root (`d:\Code\vlearn`).
2. Install dependencies (if not already installed):
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
   The frontend will start at `http://localhost:5173`.

## Features Implemented

1. **UI Overhaul**: 
   - Sidebar menu on the left.
   - Modern, clean aesthetic ("High-level").
   - Review mode separated into the menu.
2. **Settings Page**:
   - User account info.
   - Data Import/Export (JSON).
   - Share Code functionality.
3. **Wrong Question Logic**:
   - Added "Programming" subject.
   - Implemented detailed, subject-specific error tags (e.g., "Syntax Error" for Programming, "Tense Error" for English).
   - Click-to-reveal interaction for answers.
4. **AI Integration**:
   - Java Backend acts as a proxy to Doubao API.
   - Enforces JSON format for consistent question generation.
   - Supports Multiple Choice, Fill-in-the-blank, and Essay questions.

## API Endpoints (Localhost:8080)

- `GET /api/questions`: Get all questions
- `POST /api/questions`: Create a new question
- `GET /api/questions/review`: Get questions due for review
- `POST /api/questions/{id}/review`: Submit review result
- `POST /api/ai/generate`: Generate question using Doubao AI
