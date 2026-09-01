# BLinkMaestra

(formerly DepEd Teacher Copilot)

BLinkMaestra is a workflow-first copilot for DepEd teachers: start from a professional task, provide only the context that is missing, and receive an editable, versioned, exportable draft.

## Architecture

```
server.js            HTTP entry + static file serving
src/
  router.js          All API routes, rate limiting, error sanitization
  auth.js            Magic-link & password auth, roles, persisted sessions
  db.js              Datastore: PostgreSQL-backed (single JSONB row) when
                     DATABASE_URL is set, else a local JSON file. Holds users,
                     profiles, sessions, tokens, documents, versions, aiRequests,
                     feedback, auditLog, settings, templates, knowledge
  billing.js         Monetization: free-trial allowance, GCash subscriptions,
                     admin payment approval, payments on/off toggle
  mail.js            SMTP delivery for magic links & password resets
  documents.js       Document lifecycle: CRUD, versions, trash/archive/duplicate
  pipeline.js        Generation pipeline: routing → knowledge → AI → validation
  ai.js              Provider abstraction (OpenCode Zen / OpenAI-compatible/Groq)
  knowledge.js       Categorized knowledge retrieval (capability-aware)
  capabilities.js    Capability catalog, intent routing, related-work chains
  templates.js       Seeded guided-workflow templates
  export.js          Real DOCX (docx) and PDF (pdfkit) generation
public/              Vanilla-JS SPA (guided input engine, editor with
                     contextual AI actions, autosave, versions, exports)
tests/server.test.js 22 end-to-end API tests
```

## Run locally

```bash
npm install
npm start          # http://localhost:4173
npm test           # 22 end-to-end API tests
```

The server reads configuration from environment variables, or you can copy `.env.example` values into your shell. The AI key can also be set in-app by an admin (Admin → AI provider configuration), which takes precedence over env vars.

### Storage: PostgreSQL (recommended) or local JSON

The app stores all state as a single JSON document. By default (no `DATABASE_URL`) it persists to a local file at `DATA_DIR/copilot.json` — ideal for local dev and tests. For production, set `DATABASE_URL` to a PostgreSQL connection string and the app stores the document as a single JSONB row, which is durable and backup-able. The module boundary in `src/db.js` transparently handles both; you don't need to change any code.

```bash
# Local (default):
npm start
# PostgreSQL:
DATABASE_URL="postgres://user:pass@host:5432/db" npm start
```

### Billing & subscriptions (monetization)

BLinkMaestra ships with an optional payment module for the subscription model:

- **Master toggle (`PAYMENTS_ENABLED`)** — **OFF by default**, so teachers can test freely. Turn it **ON** (via **Admin → Payments & subscriptions**) once you're ready to charge. When off, everyone is unlimited and no paywall appears.
- **Free trial** — a new teacher gets `FREE_ALLOWANCE` (default 5) free document generations. Only creating new AI documents counts.
- **Paywall** — when the free allowance runs out (or a paid period expires), the teacher must subscribe to keep using the workspace.
- **Subscription** — the teacher picks **1, 3, 6, or 12 months**, sees the total (months × `BILLING_PER_MONTH`, default PHP 100), and pays via **GCash** to `BILLING_GCASH` (default `09299865338`). They submit the GCash reference number + optional note.
- **Admin approval** — the admin reviews pending payments (Admin → Payments & subscriptions) and approves/rejects. On approval the teacher's access is granted from that day forward and **stacks** on any existing paid time.
- Admins are never gated.

```bash
# Env knobs (all optional; defaults shown):
PAYMENTS_ENABLED=false        # true to require payment
FREE_ALLOWANCE=5              # free generations before subscribing
BILLING_PER_MONTH=100         # PHP per month
BILLING_GCASH=09299865338     # GCash number teachers pay into
```

### AI provider

The app works with OpenCode Zen, OpenAI, or any OpenAI-compatible endpoint (e.g. **Groq**). `src/ai.js` picks a provider from the configured key/base URL/model. Examples:

```bash
# OpenCode Zen
OPENCODE_API_KEY="your-zen-key" npm start
# OpenAI
OPENAI_API_KEY="sk-..." npm start
# Groq (OpenAI-compatible)
OPENAI_API_KEY="gsk-..." AI_BASE_URL="https://api.groq.com/openai/v1" AI_MODEL="openai/gpt-oss-120b" npm start
# any OpenAI-compatible endpoint
AI_BASE_URL="https://other-provider/v1" AI_MODEL="model-name" OPENAI_API_KEY="key" npm start
```

OpenCode Zen is used automatically when `OPENCODE_API_KEY` is set (base `https://opencode.ai/zen/v1`, model `x-preview-f-free` — Ox Alpha Free). The key lives only in the server process; the browser never sees it.

### Email (magic links & password reset)

Magic-link and password-reset emails are sent over SMTP. Works with any SMTP provider (Gmail, Zoho, Brevo, SMTP2GO…). Configure via env vars:

```bash
SMTP_HOST="smtp.gmail.com"       # example: Gmail
SMTP_PORT="465"
SMTP_SECURE="true"               # implicit TLS (Gmail 465); use false for STARTTLS on 587
SMTP_USER="you@gmail.com"        # your sender address
SMTP_PASS="xxxx xxxx xxxx xxxx"  # Gmail App Password (see below)
SMTP_FROM="BLinkMaestra <you@gmail.com>"
APP_URL="http://localhost:4173"  # base URL used to build sign-in/reset links
```

**Gmail (free, personal — no work email needed):** `SMTP_PASS` must be a [Google App Password](https://myaccount.google.com/apppasswords), not your login password. Enable **2-Step Verification**, then create an App Password for "Mail" and paste the 16-char code. The sender (`SMTP_FROM`/`SMTP_USER`) is your Gmail address; recipients can be any email. Minor note: links in Gmail-sent mail may be wrapped, since Gmail delivers from your personal address.

When SMTP is **not** configured, the app logs a clickable link to stdout instead, so everything still works locally:

```
[mail/fallback] to=you@example.com subject="Your sign-in link for BLinkMaestra"
[mail/fallback] http://localhost:4173/app#magic=...
```

## Deployment

A **Render blueprint** (`render.yaml`) is included. It deploys the app as a single Node web service on Render's **free tier (no credit card required)**, with a persistent disk (`.data/`) holding the app's datastore. You set the SMTP and AI credentials as environment secrets.

Why Render (and not Vercel)? This app is a long-running Node server: AI **generation runs as an in-process background job** that the client polls, and state lives in an in-memory cache backed by a JSON file / Postgres. Vercel's serverless model gives each request its own short-lived process, so in-process jobs and the JSON cache don't survive between requests — generation-with-progress and durable storage both need real rework to work there. Render's always-on web service matches the current architecture, so it deploys unchanged.

Deploy steps:
1. Push this repo to GitHub.
2. In Render: **New → Blueprint** → select the repo. The blueprint provisions a free web service with a persistent disk, no card needed.
3. In the service's **Environment** tab, set the secrets:
   - `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (Gmail App Password, or any SMTP)
   - `APP_URL` (the `https://…` URL Render assigns the service)
   - `OPENCODE_API_KEY` or `OPENAI_API_KEY` (+ `AI_BASE_URL`/`AI_MODEL`), or set these in-app after the first deploy.
4. Payment is **off** by default. When you're ready to monetize, turn it on in **Admin → Payments & subscriptions** (or set `PAYMENTS_ENABLED=true`).

Free-tier limits to know: the service **spins down after ~15 min idle** (takes ~1 min to wake), and you get **750 instance-hours/month**. That's fine for an internal teacher tool but not for heavy public traffic.

To move to production later: set the web service to `starter` (always on) and add a managed **PostgreSQL** database, setting `DATABASE_URL` to it. The app transparently switches from the JSON datastore to Postgres (single JSONB row) whenever `DATABASE_URL` is set — see [Storage](#storage-postgresql-recommended-or-local-json).

The render blueprint defaults to the Gmail SMTP host/port. Any SMTP provider can be used by adjusting `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`. Google sometimes blocks SMTP from cloud/datacenter IPs — if Gmail fails in production, use a transactional provider (Brevo/Resend/SMTP2GO) which is a simple env change in `src/mail.js`.

## What is implemented

- **Auth** — email **magic-link sign-in** (password + register also supported). Request a link on the login screen and it's delivered to the inbox over SMTP. Persistent HttpOnly sessions with expiry.
- **Roles** — `admin` and `teacher`. `betchay.canyas@gmail.com` is a bootstrap admin (email also configurable via the `ADMIN_EMAILS` env var). Admins see the Admin workspace and can set the AI keys in-app.
- **Admin AI configuration** — admins set the AI provider keys from **Admin → AI provider configuration** without touching server env. Keys persist in the datastore, are masked in the API, and never reach the browser.
- **Onboarding & profile** — 3-step skippable wizard; saved grade levels, subjects, school, division, region, language, duration, preferences; context can be disabled
- **Guided input engine** — templates declare required fields; fields already known from the profile or inherited from a previous document are never asked again
- **Capability routing** — `/api/route` maps natural-language requests ("create a 20-item quiz") to capabilities
- **Generation pipeline** — staged progress UI, capability-aware knowledge retrieval, post-generation validation (length, structure, fabricated-reference detection) with one retry, labeled assumptions
- **Document workspace** — rich-text editing, selection-scoped AI actions (improve/rewrite/simplify/expand/shorten/translate/tone), accept-or-keep proposals, autosave ("Saving… / Saved · vN / Unable to save"), local draft recovery after failure
- **Versioning** — every content change snapshots the prior state; view/restore any version; restores are themselves versioned
- **My Documents** — search, sort, status filter, favorites, archive, trash with restore and permanent delete
- **Workflow chaining** — lesson plan → assessment/activity sheet/remediation etc., carrying topic, quarter, week, and grade context forward; related-work recommendations on each document
- **Export** — genuine `.docx` and `.pdf` files rendered server-side from document structure, plus print stylesheet
- **Admin surface** — Admin workspace with competency import, knowledge/template management, **AI provider configuration** (set keys in-app), and **Payments & subscriptions** (turn payments on/off, review and approve teacher payments), all gated server-side behind the `admin` role
- **Billing / monetization** — optional payments module (off by default): free-trial allowance, GCash subscription orders with admin approval, stacking expiry, and a full-access paywall
- **Feedback & history** — helpful/not-helpful per document; per-user AI generation history
- **Security** — ownership checks on every document request, admin role enforcement, rate limiting on generate/refine/export, sanitized errors, no stack traces to clients

## Production notes

State is stored in **PostgreSQL** (single JSONB row) when `DATABASE_URL` is set, which is the recommended production setup and is durable/backup-able. Terminate TLS at the edge (`Secure` cookies enable automatically with `NODE_ENV=production`), set `APP_URL` to the public origin, and run `NODE_ENV=production`. Email delivery for magic links and password resets is already implemented via SMTP. Generation runs as an in-process background job — on a single Render service this is fine, but multi-instance deploys should externalize job state.
