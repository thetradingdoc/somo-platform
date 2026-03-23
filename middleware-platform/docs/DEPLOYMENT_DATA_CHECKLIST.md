# Deployment data checklist (gates + LLM-4)

**impl-6 / impl-13:** Verify in each production/staging environment **before** relying on booking/triage gates or language persistence.

## Triage gate columns (impl-6)

- [ ] Migrations that add **`intake_complete_at`** (and related triage columns) have been **applied** — see `BOOKING_CHECKOUT_ARCHITECTURE_ANALYSIS.md` (BUG-011/015).
- [ ] Smoke test: complete triage → **`intake_complete_at`** non-null in `triage_sessions` → schedule succeeds past **`RICH_INTAKE_REQUIRED`** / **`TRIAGE_INCOMPLETE`**.
- [ ] Optional: alert or dashboard on high rate of **403** responses with `TRIAGE_INCOMPLETE`, `TRIAGE_NOT_STARTED`, or `RICH_INTAKE_REQUIRED` (unexpected volume may indicate migration drift or client bugs).

## Language persistence (impl-13 / gap18)

- [ ] **`kelly_session_meta`** exists and includes **`preferred_language`** (migration `010_triage_soap_practitioner_unique.js` or equivalent).
- [ ] Smoke: first Kelly turn sets language → subsequent turns read from meta (no per-turn drift) — see `kelly-agent-service.js` gap18 path.

## Voice triage parity (ops)

- [ ] **`REQUIRE_TRIAGE_FOR_VOICE=1`** in production unless explicitly documented otherwise (`VOICE_TRIAGE_PARITY.md`).
- [ ] **`LEGACY_APPOINTMENTS_API_DISABLED`** policy decided (410 vs migration window).

## Patient Orchestrator (impl-5 / C1)

- [ ] Understand: orchestrator applies **`evaluateTriageGuardrailsForSession`** only when a **`triage_sessions`** row exists for **`session.session_id`** — see `docs/architecture/PATIENT_ORCHESTRATOR_TRIAGE_PROVENANCE.md`.
- [ ] Voice E2E: orchestrator session id aligned with Kelly triage → booking blocked until triage complete (if testing that path).

## Postgres `voice_checkouts` (impl-9)

- [ ] **`POSTGRES_URL`** deployments: **`triage_session_id`** column exists (auto **`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`** on first `createVoiceCheckout`).
- [ ] Verify checkout insert includes audit id when using voice checkout with session context.
