# V1 product decisions — photo-first routine loop

**Last updated:** 2026-05-21

Locked decisions for Skin & Care routine tracker v1. See [06-mobile-and-web-parity.md](./06-mobile-and-web-parity.md) for routes and verification.

## Surface priority

Fix the **shared backend first**. The 0% progress bug lives in the API (photo did not write `item_logs`). Web and app both heal when `POST /api/patient/routine/daily/:id/photo` completes the day server-side.

## Clinical library on Today

1. **Phase summary card** — render `focus`, `expect`, `notes` from `GET /api/patient/routine/phase` (curated JSON, not RAG).
2. **Per-step “Why this?”** — deferred (retinoid / SPF); bounded RAG later.
3. **Floating chat** — not in v1 (support liability).

## Definition of a logged day

**One progress photo = day complete.** No required step checklists on the hero screen. Prescription and newly diagnosed users get depth from phase copy and red flags, not more logging UI.

## API contract (photo)

On successful photo upload:

- `patient_routine_daily_entries.completion_score` → `100`
- `patient_routine_daily_item_logs` → all active `template_items` marked `completed = 1` for that day
- `GET /api/patient/home/progress-summary` → `summary.today_logged: true`, `in_progress: 0`
- `assistant_summary` in response / `skin_report` includes phase `expect` when available
- `skin_report.frozen_steps` — phase-appropriate steps snapshot at upload time (used for historical display)
- **Today only:** `patient_routine_daily_item_logs` synced from active template items
- **Backfill (last 48h):** photo allowed; item_logs skipped; `frozen_steps` written to `skin_report` instead
- **Older than 48h:** read-only (`HISTORICAL_READ_ONLY`); no photo or daily POST mutations

## V1 readiness test

A user on week 3 of the acne program takes a photo, reads phase `expect` copy (e.g. mild purging is normal), sees no 0% on progress cards, and feels reassured — not blamed. Ship when that loop works.

## Out of scope (v1)

- Floating RAG chat on Today
- Optional symptom prompt (“Any redness today?”) — v1.1
- Handoff analytics (`auth_handoff_continue_web`) before loop is trusted
- Web journal `media-link` path unification (legacy; Today uses `/photo` like the app)
