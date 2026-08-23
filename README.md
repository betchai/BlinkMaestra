# BLinkMaestra

(formerly DepEd Teacher Copilot)

BLinkMaestra is a workflow-first copilot for DepEd teachers: start from a professional task, provide only the context that is missing, and receive an editable, versioned, exportable draft.

## Architecture

```
server.js            HTTP entry + static file serving
src/
  router.js          All API routes, rate limiting, error sanitization
  auth.js            Registration, login/logout, password reset, persisted sessions
  db.js              JSON datastore (users, profiles, sessions, documents,
                     versions, aiRequests, feedback, auditLog, templates, knowledge)
  documents.js       Document lifecycle: CRUD, versions, trash/archive/duplicate
  pipeline.js        Generation pipeline: routing → knowledge → AI → validation
  ai.js              Provider abstraction (OpenAI provider; swappable)
  knowledge.js       Categorized knowledge retrieval (capability-aware)
  capabilities.js    Capability catalog, intent routing, related-work chains
  templates.js       Seeded guided-workflow templates
  export.js          Real DOCX (docx) and PDF (pdfkit) generation
public/              Vanilla-JS SPA (guided input engine, editor with
                     contextual AI actions, autosave, versions, exports)
tests/server.test.js 15 end-to-end API tests
```

## Run locally

```bash
OPENCODE_API_KEY="your-zen-key" npm start    # OpenCode Zen (default model: x-preview-f-free / Ox Alpha Free)
# or OpenAI:
OPENAI_API_KEY="sk-..." npm start
# or any OpenAI-compatible endpoint:
AI_BASE_URL="https://other-provider/v1" AI_MODEL="model-name" OPENAI_API_KEY="key" npm start
```

Runs on port 4173 (override with `PORT`). `npm test` runs the full API suite.

OpenCode Zen is used automatically when `OPENCODE_API_KEY` is set (base `https://opencode.ai/zen/v1`, model `x-preview-f-free` — Ox Alpha Free). The key lives only in the server process; the browser never sees it.

## What is implemented

- **Auth** — register/login/logout, forgot/reset password (reset token logged for the operator; wire to email in production), persistent HttpOnly sessions with expiry
- **Onboarding & profile** — 3-step skippable wizard; saved grade levels, subjects, school, division, region, language, duration, preferences; context can be disabled
- **Guided input engine** — templates declare required fields; fields already known from the profile or inherited from a previous document are never asked again
- **Capability routing** — `/api/route` maps natural-language requests ("create a 20-item quiz") to capabilities
- **Generation pipeline** — staged progress UI, capability-aware knowledge retrieval, post-generation validation (length, structure, fabricated-reference detection) with one retry, labeled assumptions
- **Document workspace** — rich-text editing, selection-scoped AI actions (improve/rewrite/simplify/expand/shorten/translate/tone), accept-or-keep proposals, autosave ("Saving… / Saved · vN / Unable to save"), local draft recovery after failure
- **Versioning** — every content change snapshots the prior state; view/restore any version; restores are themselves versioned
- **My Documents** — search, sort, status filter, favorites, archive, trash with restore and permanent delete
- **Workflow chaining** — lesson plan → assessment/activity sheet/remediation etc., carrying topic, quarter, week, and grade context forward; related-work recommendations on each document
- **Export** — genuine `.docx` and `.pdf` files rendered server-side from document structure, plus print stylesheet
- **Admin surface** — `/api/admin/templates` and `/api/admin/knowledge` endpoints gated server-side behind the `admin` role
- **Feedback & history** — helpful/not-helpful per document; per-user AI generation history
- **Security** — ownership checks on every document request, admin role enforcement, rate limiting on generate/refine/export, sanitized errors, no stack traces to clients

## Production notes

Move the JSON datastore to PostgreSQL (the module boundary in `src/db.js` is the swap point), sessions to Redis, add email delivery for password resets, terminate TLS at the edge (`Secure` cookies enable automatically with `NODE_ENV=production`), and run `NODE_ENV=production`.
