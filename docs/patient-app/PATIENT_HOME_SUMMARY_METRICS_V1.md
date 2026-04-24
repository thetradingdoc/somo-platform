# Home Summary Metrics — V1

**Last updated:** 2026-04-22  
**UI:** `unified-dashboard/patients/patient-dashboard.html`  
**API:** `GET /api/patient/home/progress-summary`

---

## 1. Purpose

Drive the **routine-first** home board: top-line stats, weekly cards, and empty states — all derived from **routine template + daily entries** (not wallet or generic placeholders).

---

## 2. Response shape (conceptual)

- `has_template` — whether an active template exists.  
- `summary` — aggregates such as `adherence_pct` (rolling window), `upcoming`, `in_progress`, `total_tasks`, etc.  
- `cards` — array of card objects (`title`, `subtitle`, `progress_pct`, `date_label`, …) for list/grid rendering.

When `has_template` is false, the UI shows a **new-user** empty state and hides the compact scan FAB until a template exists.

---

## 3. Client analytics

After a **successful** progress summary load, the portal may call:

`POST /api/patient/analytics/event` with body `{ "event": "home_summary_viewed" }` (session header/cookie as for other patient APIs).

Server also records template/daily/media events on the corresponding POST routes (see backend routes doc).

---

## 4. Reliability

- Failed summary load: inline error / retry affordance on Home.  
- Catalog index health (optional banner): `GET /api/patient/health/catalog` for product search readiness.

---

## 5. Related

- `PATIENT_JOURNAL_REDESIGN_V1.md`  
- `BACKEND_ROUTES_AND_TABLES_PATIENT_PORTAL.md`
