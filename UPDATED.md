# BLinkMaestra — Project Status (UPDATED.md)

> Resume notes for future sessions. Last updated: 2026-08-23.
> Repo: https://github.com/betchai/BlinkMaestra · Latest commit: `621fe28` (pushed)

## What this is
Workflow-first AI copilot for DepEd teachers ("BLinkMaestra", formerly "DepEd Teacher Copilot").
Teacher picks a task → answers only missing info → gets an editable, versioned, exportable document.
No AI prompting skills required. Landing page at `/`, app at `/app`.

## How to run
```bash
npm install
ADMIN_EMAILS="betchay.canyas@gmail.com" OPENCODE_API_KEY="<zen key>" npm start   # port 4173
npm test                                                                          # 15 API tests, isolated DATA_DIR
```
- AI provider: **OpenCode Zen** (`https://opencode.ai/zen/v1`, model `x-preview-f-free` / Ox Alpha Free) via `OPENCODE_API_KEY`; or OpenAI via `OPENAI_API_KEY`. Overrides: `AI_BASE_URL`, `AI_MODEL`.
- Free model is a slow reasoning model: generation takes ~1–5 min. Job system + live progress UI handles it.

## Architecture
```
server.js            HTTP entry; landing page at /, app at /app
src/router.js        API routes, rate limits, in-memory generation jobs (POST /api/generate → jobId, GET /api/generate/:id)
src/auth.js          scrypt passwords, persistent sessions, password reset (token logged to console), ADMIN_EMAILS role promotion at login
src/db.js            JSON store (.data/copilot.json): users, profiles, sessions, documents(+versions), aiRequests, feedback, auditLog, templates, knowledge, competencies. Swap point for a real DB.
src/pipeline.js      Generation pipeline: route → knowledge → AI → validation (retries once on gaps). ILAW instructions injected for Lesson Planning.
src/ai.js            OpenAI-compatible provider abstraction; response_format with 400-fallback; transient retry; JSON repair (fences, raw newlines)
src/knowledge.js     Categorized refs w/ capability filtering; ILAW framework entry = OFFICIAL REQUIREMENT (D.O. 016 s.2026)
src/capabilities.js  Capability catalog, keyword intent routing (/api/route), related-work chains ({label, template})
src/templates.js     Seed templates incl. 'ilaw' v2.0 (ILAW Lesson Plan)
src/documents.js     CRUD, versioning (every change snapshots prior state), trash/archive/duplicate/restore
src/export.js        Real DOCX (docx) + PDF (pdfkit) from the HTML subset
src/curriculum.js    Competency library seed (48 curated) + search; full CG importable via admin
public/js/app.js     SPA: auth, onboarding wizard, dashboard, guided workflows, workspace (AI selection edits, autosave, versions), documents, admin, settings
tests/server.test.js 15 tests; spawns server with temp DATA_DIR (never touches real data)
```

## Key decisions / gotchas
- `.data/` is gitignored — contains real user data. NEVER commit it.
- Tests use their own DATA_DIR (a bug once wiped the user's account by sharing the file).
- Generation results are saved as documents client-side after job completes; jobs are in-memory (server restart loses in-flight attempt only).
- Legacy stored templates are overridden by seeds on load (template migration in db.js).
- Related-work buttons are structured `{label, template}` — never free text (dead-link bug fixed).
- Errors are sanitized before reaching clients; raw stack traces stay in logs.

## Feature status
Done:
- Auth (+forgot/reset), onboarding wizard, profile with context toggle
- Guided input engine (skips known fields; inherits context from chained docs)
- Capability routing (/api/route); related-work chaining with context hand-off
- ILAW lesson plan template (D.O. 016 s.2026) + AI declaration section
- Workspace: contenteditable editor, selection AI actions (improve/simplify/translate/etc., accept-or-keep), autosave + local draft recovery, version history/view/restore, sources viewer, feedback widget
- Documents: search/filter/sort/favorites/archive/trash/purge/duplicate; global search ("/")
- Real DOCX/PDF export; print stylesheet
- Live generation progress (jobId polling, elapsed timer, failure screen w/ Try again)
- Competency reference library: Settings tab + in-workflow "Browse…" picker modal; saved competencies feed workflow autocomplete and generation context
- Admin area (role-gated): competency CSV/JSON import, knowledge add/deactivate, template activate/deactivate
- Landing page (marketing) as homepage; branding = BLinkMaestra everywhere

Known limitations:
- Competency library has only 73 entries (24+25 curated/imported from one CG PDF: Reading & Literacy G1). Full MATATAG coverage requires importing official CG PDFs' tables via Admin import (PDFs only exist as downloads; no machine-readable dataset).
- Password reset token printed to server console (no email service).
- JSON datastore + in-memory sessions/jobs: fine for single-server dev; swap db.js for production.
- Quarter assignments from imported CG were inferred from macro-skill markers — spot-check accuracy.

## Environment / accounts
- Server runs in background (nohup), logs: `/tmp/copilot.log`
- User account: betchay.canyas@gmail.com (admin when whitelisted; password known only to user)
- QA account: qa@x.test / password123 (also whitelisted admin)
- GitHub: push works from user's terminal after gh auth login (HTTPS). Remote origin set.

## Immediate next-step candidates
1. Import remaining MATATAG CGs (user provides Google Drive links per subject/grade; parser exists — see /tmp/cg.txt pipeline notes)
2. Verify quarter-term mapping against official Trimester BOW
3. Consider SSE instead of polling if latency UX matters
4. Production hardening: real DB, Redis sessions, email for resets, TLS
