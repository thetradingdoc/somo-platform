# Kelly Conversation Rails — Golden path (archived)

> Extracted from `pending/KELLY_CONVERSATION_RAILS_TODOS.md` on 2026-05-31 when golden-path work (Sprints 0–3 + F1b/F1c/Playwright skip-triage) was completed.  
> **Open items:** [`../pending/KELLY_CONVERSATION_RAILS_TODOS.md`](../pending/KELLY_CONVERSATION_RAILS_TODOS.md)

Canonical scenario: **clinic derm rash** (not chest pain / emergency rail)

## Session storage

| Store | Mechanism |
|-------|-----------|
| Transcript | `kelly_conversation_history` |
| Flags | `kelly_session_meta_kv` |
| Triage | `triage_sessions` + `triage_rag_results` |
| Phase | `kelly_orchestrator_phase` in meta; recomputed in `resolveOrchestrationPhase` |

Fixtures: [`middleware-platform/e2e/helpers/kelly-conversation-fixtures.cjs`](../../middleware-platform/e2e/helpers/kelly-conversation-fixtures.cjs)

## Pinned phase contract (F1a derm path)

| Turn | Expected phase (end) | Hard tool assert |
|------|----------------------|------------------|
| T1 | `TRIAGE_DISCOVERY` or `TRIAGE_ACTIVE` | S0-1: not `ROUTINE_INTAKE` |
| T2 | `TRIAGE_ACTIVE` | optional T2b if low confidence |
| T3 | `BOOKING` | `get_available_slots` |
| T4 | `BOOKING` | `schedule_appointment` |
| T5 | `BILLING` | insurance/copay language |
| T6 | `BILLING` | `request_patient_payment` |

## A1a-spec — minimum intake (clinic derm)

Implemented in `KellyOrchestratorPhase.clinicDermMinimumIntakeMet`:

1. `step1_skin_type_status === 'confirmed'` OR non-unknown skin value
2. OPQRST minimum: chief complaint (`quality`), body site (`region`), severity, timeline (`onset`)

## S0-3 fixture spec (`seedBookingReady`)

| Layer | Required |
|-------|----------|
| Meta | `routine_intake_active=0`, `kelly_triage_reopen=0`, `kelly_orchestrator_phase=BOOKING` |
| `triage_sessions` | `triage_complete=1`, `opqrst_complete=1`, linked `rag_result_id`, `detected_language=en` |
| `triage_rag_results` | `rag_confidence ≥ 0.7`, `differentials ≥ 1`, `target_specialty=Dermatology` (override via `targetSpecialty` opt) |

Preflight: `verifyBookingFixtureGates` → `FIXTURE_GAP` vs `PRODUCT_GAP`

## E2E env vars

| Variable | Scope |
|----------|--------|
| `KELLY_E2E_SKIP_TRIAGE=1` | Kelly slot/orchestrator gates only (E2E) |
| `RCM_E2E_SKIP_GATES=1` | RCM journey HTTP API only — **not** Kelly slots |
| `KELLY_E2E_VISIT_ONLY=1` | F1a T1–T4 only |
| `RCM_E2E_WALLET_TEST=1` | Wallet bill-status with seeded patient session |
| `RCM_E2E_STRIPE_LIVE=1` | Playwright golden path Layer 3 live Stripe on `pay.html` |
| `FEATURE_PATIENT_CHAT_ENABLED=1` | **Required on server** for browser golden path (`/api/patient/triage/message`) |

## npm scripts

```bash
npm run test:e2e:kelly:visit              # F1a visit line (Node)
npm run test:e2e:kelly:booking-fixture      # F1b
npm run test:e2e:kelly:pay-fixture          # F1c
npm run test:e2e:rcm:conversation           # F2 full golden path (Node)
npm run test:e2e:rcm:pay-gateway            # F3 tool gateway

# Playwright browser golden path (triage.html → pay.html)
npm run test:e2e:kelly:golden               # full chain (needs LLM + RCM_E2E_STRIPE_LIVE=1)
npm run test:e2e:kelly:golden:visit           # T1–T4 only (KELLY_E2E_VISIT_ONLY=1)
npm run test:e2e:kelly:golden:skip-triage     # booking-ready fixture (KELLY_E2E_SKIP_TRIAGE=1)
```

Report: `playwright-report/kelly-golden-path-report.json` (sprint-labeled scorecard).  
Spec: [`e2e/kelly-rcm-golden-path.spec.cjs`](../../middleware-platform/e2e/kelly-rcm-golden-path.spec.cjs)

## E2E golden path status (2026-05-31)

| Script | Status | Notes |
|--------|--------|-------|
| F1b `test:e2e:kelly:booking-fixture` | **PASS** | T3 slots + T4 schedule; `appointments` row with `target_specialty` from session |
| F1c `test:e2e:kelly:pay-fixture` | **PASS** | `request_patient_payment` + pay token in meta/DB |
| F2 `test:e2e:rcm:conversation` | partial | Pay link stages pass; full T1–T4 blocked by Step1 skincare clarifier on clinical derm turns (backlog) |
| Playwright `golden:skip-triage` | **PASS** | T3–T4 browser (6.1m) + T5–T6 pay link; `triage.html` fetch timeout 900s |

**Dev DB prerequisite:** `npm run seed:demo` then fixtures call `seedE2eBookableProvider(clinicId, { specialty })` — sets online provider + 24h heartbeat + availability blocks. Canonical E2E scenario is derm rash; pass `targetSpecialty` in fixture opts for other specialties.

**Golden path fixes (P1/P4):** Groq fallback skips `run_triage_rag` when triage locked; `getAuthoritativeForSession` wired to HTTP/tool gates; `enrichFromSymptoms` will not overwrite linked RAG after `triage_complete`; E2E HTTP bypass removed from `voice-triage-guards`.

## Sprint status (completed)

### Sprint 0 — Test harness ✅
- S0-1 clinic guard, S0-2/3 fixtures, S0-3a preflight, S0-4 asserts, S0-5 E2E split, S0-6 teardown

### Sprint 1 — Visit line ✅
- A1a/A1b/A1c Step1 + resolver + meta
- A2a-rag auto `run_triage_rag`, A2c `KELLY_E2E_SKIP_TRIAGE`, A2d T2b optional
- A3 booking + A3-err fallbacks + A3-filter unit test

### Sprint 2 — RCM pay line ✅
- A4 `request_patient_payment` in KELLY_TOOLS + BILLING allow-list
- A5 pay-now bypasses billing fast-path
- A6/A7 journey advance on pay tool + `seedPayReady`
- F1c/F2/F3 scripts wired

### Sprint 3 — Proof ✅ (code paths)
- TODO-06 journey auto-start on Kelly call
- TODO-11 `syncCopayFromEligibility`
- G1 idempotency test
- A9 `seedPatientSessionForE2e` + `RCM_E2E_WALLET_TEST`
- A8 live Stripe: existing `RCM_E2E_STRIPE_LIVE=1` path

## Dependency graph

```
S0 fixtures → F1b (booking isolate)
A1 + A2 → F1a (full visit)
F1a + A4/A5 → F2 (golden pay path)
F2 (Node) + Playwright → `test:e2e:kelly:golden` (browser triage → pay.html)
```
