# Patient timeline, routine & billing — architecture snapshot

> Last reviewed: 2026-05-21

This note complements [`docs/architecture/README.md`](../README.md) (canonical index) and is listed in **[`docs/meta/CANONICAL_DOC_MAP.md`](../../meta/CANONICAL_DOC_MAP.md)**. It covers **routine Today** (photo loop), **Timeline / journal**, **middleware calendar-range**, and **billing** APIs.

**Routine tracker (MVP):** product flow and URLs live in [`docs/user-journey/`](../../user-journey/README.md) — especially [07-v1-product-decisions.md](../../user-journey/07-v1-product-decisions.md) and [06-mobile-and-web-parity.md](../../user-journey/06-mobile-and-web-parity.md).

## Patient app routes

| Tab | File | Role |
|-----|------|------|
| Today | `patient-app/app/(tabs)/today.tsx` | Default tab — phase card, photo CTA, `/phase` steps. |
| Timeline | `patient-app/app/(tabs)/timeline.tsx` | Re-exports **Journal** (`journal.tsx`). |
| Journal (same screen) | `patient-app/app/(tabs)/journal.tsx` | Segments **Calendar \| List \| Documents**; loads calendar range + billing events + documents. |
| Money | `patient-app/app/(tabs)/money.tsx` | `GET /api/patient/billing/money-summary`. |
| Profile | `patient-app/app/(tabs)/profile.tsx` | Re-exports **Insights** (`insights.tsx`). |

## Routine APIs (SQLite / `db.db`)

**Route module:** [`middleware-platform/routes/patient-routine.js`](../../../middleware-platform/routes/patient-routine.js). **Logic:** [`lib/`](../../../middleware-platform/lib/) (`routine-day-mode`, `routine-photo-day`, `routine-calendar-enrich`, `routine-compare-helper`, `routine-layering-check`).

- **`GET /api/patient/routine/phase`** — Current program week, `expect` / `focus` / `notes`, AM/PM items; `day_mode` for backfill/historical.
- **`GET /api/patient/routine/compare`** — Two-date compare bundle for journal.
- **`GET /api/patient/routine/layering-check`** — Ingredient conflict copy (not toxicity scores).
- **`POST /api/patient/routine/daily/:id/photo`** — Progress photo; [`lib/routine-photo-day.js`](../../../middleware-platform/lib/routine-photo-day.js) applies `frozen_steps` / optional `symptom_tags`.
- **`GET /api/patient/home/progress-summary`** — Phase-aware portfolio cards + `summary.today_logged`.

## Middleware APIs — journal & billing (SQLite / `db.db`)

- **`GET /api/patient/journal/calendar-range`** — [`routes/patient-routine.js`](../../../middleware-platform/routes/patient-routine.js): routine days + billing overlays (`phase_band`, `milestone_label`, symptoms).
- **`GET /api/patient/billing/events`** — [`routes/patient-billing-portal.js`](../../../middleware-platform/routes/patient-billing-portal.js): one row per event; **`?sort=created_at`** for legacy ordering.

Shared query: [`middleware-platform/lib/patient-calendar-billing-query.js`](../../../middleware-platform/lib/patient-calendar-billing-query.js). Aggregate mapping: [`middleware-platform/lib/billing-calendar-agg.js`](../../../middleware-platform/lib/billing-calendar-agg.js).

## Postgres vs SQLite

[`middleware-platform/database.js`](../../../middleware-platform/database.js) can enable **Postgres** when `POSTGRES_URL` is set for **selected** features. **Patient portal journal / calendar-range / billing list** use **`db.db` (better-sqlite3)** via the route modules above. Before assuming Postgres parity, confirm deployment topology.

## Server decomposition

See [`docs/architecture/SERVER_DECOMPOSITION.md`](../SERVER_DECOMPOSITION.md) for how `server.js` mounts patient route groups and where to add new endpoints.

## Web dashboard parity

`unified-dashboard/patients/schedule.html` uses the same **`calendar-range`** endpoint and honors **`billing_visual`** for day styling and the check-in list.

## Related todos

Rollout and extraction work: [`todos/pending/PHOTO_TO_BILL_EXTRACTION_TODOS.md`](../../../todos/pending/PHOTO_TO_BILL_EXTRACTION_TODOS.md) (Phase 6 and follow-ups).
