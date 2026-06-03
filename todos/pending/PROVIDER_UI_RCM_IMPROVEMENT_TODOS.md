# Provider UI + RCM visibility todos

**Status:** completed (2026-06-01)  
**Source:** Provider UI RCM improvement plan

## P0 — Latency

- [x] Turn instrumentation: `latency_ms`, `clinic_id`, `patient_id` on all `turn_resolved` events
- [x] Voice filler: `sendRetellInterim` + `KELLY_VOICE_FILLER_MS` (default 1200ms)
- [x] Fast RAG default: `KELLY_RAILS_FAST_RAG=1` in Cloud Run env yaml + booking-path skip
- [x] Probe script: `middleware-platform/scripts/kelly-voice-latency-probe.cjs`

## P1 — Kelly visibility

- [x] `kelly-activity-feed-service.js` + `GET /api/kelly/activity`
- [x] `listKellyCallEventsForClinic` with clinic scoping
- [x] Rich tool events: `appointment_booked`, `payment_link_sent`
- [x] Today page: Kelly activity panel + 30s poll
- [x] Today page: open journeys strip via `ppFetchRcmJourneys`
- [x] Payment alert dedupe against Kelly feed

## P2 — Patient roster

- [x] `GET /api/rcm/patient-context` (journey + PA flags)
- [x] `ppJourneyStageChip` + roster action/PA chips
- [x] CSS: `pp-patient-chip--action`, `pp-patient-chip--pa`

## P3 — Navigation

- [x] Sidebar renames (Claim status, Create claim, Exception inbox, Prior auth queue)
- [x] Hide `#billingSectionTabs` when `?section=` (unless `legacy_tabs=1`)
- [x] Redirect `billing.html?section=overview` → `rcm.html`

## P4 — Collection resend

- [x] `POST /api/rcm/collection-queue/:journeyId/resend`
- [x] `recordAgentAction` + `collection_outreach` Kelly event
- [x] UI: agent.html, rcm.html, patient-payments.html

## P5 — Tests & docs

- [x] Jest: `kelly-activity-feed.test.js`, `rcm-patient-context.test.js`, `rcm-collection-resend.test.js`
- [x] Playwright: Today Kelly panel, billing tab hide, overview redirect
- [x] `docs/RCM/ARCHITECTURE.md` provider visibility contract
- [x] `RCM_MASTER_BACKLOG_STATUS.md` correction
