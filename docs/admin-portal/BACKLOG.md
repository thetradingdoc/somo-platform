# Admin CRM Backlog — status reference

**Last updated:** 2026-06-30

Master IDs from the full implementation plan. Status reflects the 2026-06-30 implementation pass.

## P0 — Data pipeline integrity

| ID | Item | Status |
|----|------|--------|
| P0-1 | Save all non-dupe leads (phoneless OK); `saved_callable` / `saved_needs_phone` metrics | Done |
| P0-2 | Gate calls/kanban on phone; needs-phone queue on pipeline | Done |
| P0-3 | Batch enrich archive not delete | Done |
| P0-4 | `cleanup-sales-leads.js` report only, no delete | Done |
| P0-5 | Scrape diagnostics on GET `/status` + control board strip | Done |
| P0-6 | Delete with `admin_lead_deletions` audit + lead.html UI | Done |

## P1 — Contact, tenants, UI shell

| ID | Item | Status |
|----|------|--------|
| P1-1 | Decouple `findClinicWebsite` from JSearch URL; `SERPAPI_KEY` in `.env.example` | Done |
| P1-2 | Manual website override on lead detail | Done |
| P1-3 | Unified scrape pipelines (ingestion + nightly script) | Done |
| P1-4 | Insights auto_save same rules as scrape/run | Done |
| P1-5 | `merge-duplicate-clinics.js` FK re-point | Done |
| P1-6 | Unique slug migration 089 | Done |
| P1-7 | Grouped tenant alerts backend | Done |
| P1-8 | Grouped alerts UI (index + tenants) | Done |
| P1-9 | Real last-run banner from scheduler JSON | Done |
| P1-10 | Honest scrape engine labeling in modal/status | Done |
| P1-11 | API env badge in admin-shell | Done |
| P1-12 | `admin-job-modal.js` inline enrich/scrape | Done |

## P2 — UX, AI, agent

| ID | Item | Status |
|----|------|--------|
| P2-1 | Toasts + inline call status (modal for batch jobs) | Done |
| P2-2 | Disable call button while in-flight | Done |
| P2-3 | Lead detail polls after call initiated | Done |
| P2-4 | Monthly cap pre-flight + low-cap banner | Done |
| P2-5 | AI assistant wired in admin-shell | Done |
| P2-6 | AI `showLeads` uses facade + sales filters | Done |
| P2-7 | Bulk delete on needs-phone queue | Done |
| P2-8 | Enriched Retell dynamic variables | Done |
| P2-9 | Post-call stage suggestion service + HITL banner | Done |
| P2-10 | Post-call `updateLeadScore` on webhook | Done |
| P2-11 | AI tools run_scrape, suggest_call_list, call_lead HITL | Done |
| P2-12 | Scheduled calls return 400 until scheduler exists | Done |

## P3 — Ops

| ID | Item | Status |
|----|------|--------|
| P3-1 | CSV export | Done |
| P3-2 | `verify-prod-db-backup.sh` | Done |
| P3-3 | Multi-source scrape loop | Done |
| P3-4 | Sales agent config UI | Done |
| P3-5 | Auth/deploy hygiene docs + `test-admin-portal-auth.js` | Done (docs); script pre-existing |

## Supplemental

| ID | Item | Status |
|----|------|--------|
| S1 | Session `capabilities[]` + UI gating | Done |
| S2 | AI suggestions endpoint wired | Done |
| S3 | Test bulk delete documented as script-only | Done |
| S4 | `coding-reviews.html` AdminShell migration | Done |
| S5 | Tenant soft delete (`clinics.archived_at` + audit) | Done (migration 091) |
| S6 | Diagnostics strip readability + slim metrics | Done |
| S7 | Job modal auto-refresh on SSE complete | Done |
| S8 | Pipeline location filter + `/leads/locations` | Done |
| S9 | Enrich button tooltips + pipeline hint | Done |
| S10 | Suggestion card UI + dismiss | Done |

## Deferred / optional (not blocking)

- **Lead soft delete:** recoverable `archived_at` on leads instead of hard delete.
- **Full scheduled-call scheduler:** weekly/monthly recurrence via reminder-scheduler (stub returns 400).
- **Backend call idempotency:** frontend-only in-flight guard today.
- **Seed script slug upsert:** migration 089 enforces uniqueness; run `merge-duplicate-clinics.js` before index on dirty DBs.

## Tests

| Test | Path |
|------|------|
| Route smoke | `middleware-platform/scripts/test-admin-routes.js` |
| Ingestion helpers | `middleware-platform/tests/admin-scrape-ingestion.test.js` |
| Auth smoke | `middleware-platform/scripts/test-admin-portal-auth.js` |
