# Admin Portal — Operator CRM

**URL:** [https://callsomo.com/admin](https://callsomo.com/admin)

**Last updated:** 2026-06-16

<a id="admin-portal-structure"></a>

## Overview

The admin portal is a focused 4-page operator CRM for outbound sales and tenant health:

| Page | URL | Purpose |
|------|-----|---------|
| Control board | `/admin/` | Metrics, tenant alerts, funnel, scrape/enrich jobs |
| Sales pipeline | `/admin/pipeline.html` | Call-ready queue, kanban, batch calling |
| Lead detail | `/admin/lead.html?id=` | Contact, stage, notes, calls, transcripts |
| Tenants | `/admin/tenants.html` | Tenant alerts, usage, credit allocation |

## Design

- **CSS:** [`unified-dashboard/assets/css/admin-portal.css`](../unified-dashboard/assets/css/admin-portal.css) + [`somo-tokens.css`](../unified-dashboard/assets/css/somo-tokens.css)
- **Shared JS:** [`unified-dashboard/admin/assets/js/admin-shell.js`](../unified-dashboard/admin/assets/js/admin-shell.js)
- **API config:** [`unified-dashboard/assets/js/config.js`](../unified-dashboard/assets/js/config.js) — always use `window.API_BASE`

## API surface

### Scrape / CRM facade (`/api/admin/scrape/*`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/status` | Job scheduler state, lead counts, call cap |
| GET | `/leads` | Filtered lead list (`contact_status`, `specialty`, `search`) |
| GET | `/leads/call-ready` | Top verified leads in `new` stage |
| GET | `/leads/pipeline` | Kanban counts + cards |
| GET | `/leads/:id` | Lead + calls + activities |
| PUT | `/leads/:id/stage` | Update pipeline stage |
| POST | `/leads/:id/note` | Add note activity |
| POST | `/run` | SSE scrape job |

### Enrichment (`/api/admin/enrich/*`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/batch` | SSE batch contact enrichment |

### Leads (existing + aliases)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/leads/:id/call` | Outbound sales call (HITL confirm in UI) |
| POST | `/api/admin/leads/:id/enrich` | Single-lead enrich alias |
| GET | `/api/admin/leads/calls/:callId/transcript` | Call transcript |

### Tenants

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/tenants/alerts` | Computed tenant health alerts |
| GET | `/api/admin/tenants` | Tenant list with billing fields |
| GET | `/api/admin/tenants/:clinicId` | Tenant detail |
| POST | `/api/admin/tenants/:clinicId/credits` | Allocate free minutes |

## Human-in-the-loop automation

**Automated:** nightly scrape (cron script), contact extraction on save, lead scoring, post-call stage hints via Retell webhook, monthly call cap.

**Human gates:** scrape now, batch enrich, single/batch outbound calls, pipeline stage changes, demo review, transcript review, tenant credit allocation.

## Lead ingestion rules

- Scrape uses JSearch (RapidAPI) or SerpAPI — configure `JOB_SEARCH_*` in `.env` (see `.env.example`).
- Job-board URLs (Indeed, LinkedIn, etc.) are never shown as the lead website; clinic sites are preferred when discoverable.
- **Only leads with a verified US phone number are saved** to the CRM (`lead-ingestion.js`, `contact-extractor.js`).
- Job posting URLs are stored in lead notes as `job_posting_url: …` for operator reference.
- Batch enrich deletes leads that still lack a callable phone after extraction.

## Language requirements (outbound calls)

Job titles/descriptions are parsed for bilingual requirements (Russian, Mandarin, Spanish, etc.) via `lead-language-extractor.js`. Stored on each lead:

| Field | Purpose |
|-------|---------|
| `required_languages` | JSON array of language names |
| `preferred_language` | ISO code for Retell routing |
| `language_instruction` | Prompt snippet for the sales agent |

Outbound calls pass these as Retell dynamic variables. Add to the sales agent prompt:

```
{{language_instruction}}
Preferred language code: {{preferred_language}}
Required languages: {{required_languages}}
```

<a id="admin-portal-testing"></a>

## Local development

```bash
# API (from middleware-platform/)
npm start

# Admin UI — served at http://localhost:4000/admin/
# Static files: unified-dashboard/admin/

# Route smoke test (from middleware-platform/)
node scripts/test-admin-routes.js

# Pipeline debug (optional — hits live scrape/enrich APIs)
node scripts/debug-crm-pipeline.js --scrape

# Cleanup no-phone leads and strip job-board URLs
node scripts/cleanup-sales-leads.js

# Language extractor unit tests
npm test -- --testPathPattern=lead-language-extractor
```

## Deployment

Firebase hosting copies `unified-dashboard/admin/` → `hosting-dist/admin/` via `npm run build:staging-hosting`. API lives at `api.callsomo.com`.

## File locations

```
unified-dashboard/admin/
  index.html          # Control board
  pipeline.html       # Sales pipeline
  lead.html           # Lead detail
  tenants.html        # Tenant health
  assets/js/admin-shell.js

middleware-platform/routes/
  admin-scrape.js     # CRM facade
  admin-enrich.js     # Batch enrich SSE
  admin-leads.js      # Core lead/call APIs
  admin-tenants.js    # Tenant monitoring + alerts

middleware-platform/services/
  admin-lead-facade.js
  admin-job-tracker.js
  tenant-health.js
  lead-ingestion.js
  lead-language-extractor.js
  contact-extractor.js
```
