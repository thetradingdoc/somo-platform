# Admin Portal — Operator CRM

**URL:** [https://callsomo.com/admin](https://callsomo.com/admin)

**Last updated:** 2026-06-30

See also: [BACKLOG.md](./BACKLOG.md) for item IDs and deferred work.

<a id="admin-portal-structure"></a>

## Overview

The admin portal is a focused operator CRM for outbound sales and tenant health:

| Page | URL | Purpose |
|------|-----|---------|
| Control board | `/admin/` | Metrics, diagnostics, tenant alerts, funnel, scrape/enrich jobs |
| Sales pipeline | `/admin/pipeline.html` | Call-ready queue, needs-phone queue, kanban, batch calling |
| Lead detail | `/admin/lead.html?id=` | Contact, stage, notes, calls, transcripts, delete |
| Tenants | `/admin/tenants.html` | Grouped tenant alerts, usage, credit allocation |
| Sales agent | `/admin/sales-agent.html` | Sync Retell sales agent prompt |
| Coding reviews | `/admin/coding-reviews.html` | HITL coding queue (AdminShell) |

## Design

- **CSS:** [`unified-dashboard/assets/css/admin-portal.css`](../unified-dashboard/assets/css/admin-portal.css) + [`somo-tokens.css`](../unified-dashboard/assets/css/somo-tokens.css)
- **Shared JS:** [`admin-shell.js`](../unified-dashboard/admin/assets/js/admin-shell.js) (toasts, capabilities, env badge, AI), [`admin-job-modal.js`](../unified-dashboard/admin/assets/js/admin-job-modal.js) (SSE jobs)
- **API config:** [`config.js`](../unified-dashboard/assets/js/config.js) — always use `window.API_BASE`

## API surface

### Scrape / CRM facade (`/api/admin/scrape/*`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/status` | Job scheduler, `job_search_provider`, `pipeline_summary`, lead counts, call cap |
| GET | `/leads` | Filtered list (`contact_status`, `callable_only`, `specialty`, `search`) |
| GET | `/leads/export?format=csv` | CSV export of sales leads |
| GET | `/leads/call-ready` | Top verified leads in `new` stage |
| GET | `/leads/pipeline` | Kanban counts + cards (callable only in UI) |
| GET | `/leads/:id` | Lead + calls + activities |
| PUT | `/leads/:id/stage` | Update pipeline stage (callable leads only) |
| POST | `/leads/:id/suggested-stage/accept` | Accept post-call AI stage suggestion |
| POST | `/leads/:id/suggested-stage/dismiss` | Dismiss suggestion |
| POST | `/leads/:id/note` | Add note activity |
| POST | `/run` | SSE scrape job (multi-source loop, saves phoneless leads) |

### Enrichment (`/api/admin/enrich/*`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/batch` | SSE batch contact enrichment — **never deletes** phoneless leads; flags `still_needs_phone` |

### Leads (core + aliases)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/leads/:id/call` | Outbound sales call (HITL confirm in UI) |
| POST | `/api/admin/leads/:id/enrich` | Single-lead enrich |
| PUT | `/api/admin/leads/:id` | Update lead (e.g. manual `source_url` / website override) |
| DELETE | `/api/admin/leads/:id` | Delete lead — writes `admin_lead_deletions` audit first |
| POST | `/api/admin/leads/configure-sales-agent` | Push sales prompt to Retell |
| GET | `/api/admin/leads/calls/:callId/transcript` | Call transcript |

**Script-only (not in CRM UI):** `DELETE /api/admin/leads/test/bulk` — dev/test cleanup only.

### Tenants

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/tenants/alerts` | `{ alerts, grouped_alerts, clinic_count }` |
| GET | `/api/admin/tenants` | Tenant list |
| GET | `/api/admin/tenants/:clinicId` | Tenant detail |
| POST | `/api/admin/tenants/:clinicId/credits` | Allocate free minutes |

### Session / AI

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/session` | Session status + `capabilities[]` |
| POST | `/api/admin/ai/chat` | AI assistant (show_leads, stats, suggest_call_list, run_scrape, call_lead HITL) |
| GET | `/api/admin/ai/suggestions` | Enrich + call-ready suggestions |

## Human-in-the-loop automation

**Automated:** nightly scrape (`run-medical-receptionist-search.js` → unified `/scrape/run`), contact extraction on save, lead scoring, post-call stage suggestions (`admin-call-outcome-service.js`), monthly call cap.

**Human gates:** scrape now, batch enrich, outbound calls, pipeline stage accept/dismiss, lead delete, demo review, transcript review, tenant credit allocation.

## Lead ingestion rules

- **Unified path:** `admin-scrape-ingestion.js` — used by `POST /scrape/run`, insights auto-save, and `POST /save`.
- **All non-duplicate scraped leads are saved**, with or without phone. Metrics: `saved_callable` vs `saved_needs_phone`.
- Job search: JSearch (RapidAPI) or SerpAPI via `JOB_SEARCH_*`. Website discovery uses `SERPAPI_KEY` / `GOOGLE_PLACES_API_KEY` independently (see `.env.example`).
- Job-board URLs are never shown as the clinic website; stored in notes as `job_posting_url: …`.
- **Batch enrich never deletes** phoneless leads — notes get `enrich_failed:` or SSE reports `still_needs_phone`.
- **Kanban and outbound calls** require a verified phone (10+ digits). Phoneless leads appear in the **needs-phone queue** on pipeline.

## Delete policy

- Operators delete via UI → `DELETE /api/admin/leads/:id`.
- Before delete, a row is inserted into **`admin_lead_deletions`** (migration 088) with a JSON snapshot — survives cascade delete of `lead_activities`.
- Bulk delete on needs-phone queue uses the same API per lead with confirm.

## Language requirements (outbound calls)

Job titles/descriptions are parsed for bilingual requirements via `lead-language-extractor.js`. Retell dynamic variables include `language_instruction`, `preferred_language`, `required_languages`, `pipeline_stage`, `job_snippet`, `last_call_outcome`.

## Auth & deploy checklist

1. Set `ADMIN_PORTAL_SECRET` in Azure / production `.env`.
2. Firebase hosting: `npm run build:staging-hosting` copies `unified-dashboard/admin/`.
3. API at `api.callsomo.com` — verify with `node scripts/test-admin-portal-auth.js`.
4. DB backup: `scripts/verify-prod-db-backup.sh` (GCS existence check).
5. Duplicate clinics: `node scripts/merge-duplicate-clinics.js` (re-points FKs before slug unique index).

<a id="admin-portal-testing"></a>

## Local development

```bash
# API (from middleware-platform/)
npm start

# Admin UI — http://localhost:4000/admin/

# Route smoke test
node scripts/test-admin-routes.js
node tests/admin-scrape-ingestion.test.js

# Nightly scrape script (uses unified SSE endpoint)
node scripts/run-medical-receptionist-search.js

# Report phoneless leads (no delete)
node scripts/cleanup-sales-leads.js

# Merge duplicate clinic rows
node scripts/merge-duplicate-clinics.js
```

## File locations

```
unified-dashboard/admin/
  index.html, pipeline.html, lead.html, tenants.html
  sales-agent.html, coding-reviews.html
  assets/js/admin-shell.js, admin-job-modal.js, admin-ai-assistant.js

middleware-platform/
  routes/admin-scrape.js, admin-enrich.js, admin-leads.js, admin-tenants.js
  services/admin-scrape-ingestion.js, admin-lead-facade.js, admin-call-outcome-service.js
  services/tenant-health.js, admin-ai-assistant-service.js
  migrations/088_admin_lead_deletions.js, 089_clinics_slug_unique.js, 090_leads_suggested_stage.js
  scripts/run-medical-receptionist-search.js, merge-duplicate-clinics.js, verify-prod-db-backup.sh
```
