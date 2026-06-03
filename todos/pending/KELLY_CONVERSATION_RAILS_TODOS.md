# Kelly Conversation Rails — Backlog

Status: **Phase B signed off (2026-06-02)** — F2 green, runtime proof, V6-3 in-process + Cloud Run env

**Full build plan (SSOT):** [`docs/architecture/KELLY_AGENTIC_RAILS_TARGET_AND_BUILD_PLAN.md`](../../docs/architecture/KELLY_AGENTIC_RAILS_TARGET_AND_BUILD_PLAN.md)

**V2 rebuild:** [`docs/architecture/LIVE.md`](../../docs/architecture/LIVE.md#kelly-rails-v2-as-built)

**Phase C language:** [`KELLY_RAILS_PHASE_C_LANGUAGE.md`](KELLY_RAILS_PHASE_C_LANGUAGE.md)

---

## Phase B — Production-ready sign-off

### Switch 3 (product scope)

- **Patient:** appointment confirmation receipt (`post_payment` lane, deterministic copy)
- **Provider:** appointment on dashboard + clinical-prep summary (no video/portal link required)
- **Deferred:** session link / video SMS → [`KELLY_RAILS_PHASE_B_PLUS.md`](KELLY_RAILS_PHASE_B_PLUS.md)

### Week 0 — Dual-runtime gate

- [x] Cloud Run live env verified (2026-06-02: `somo-middleware` revision `somo-middleware-00002-zrj`, us-central1)
  - `KELLY_RAILS_V2=1`, `KELLY_ALLOW_HYBRID_GRAPH=0`, `KELLY_RAILS_ROLLOUT_PCT=1`
  - Re-check: `npm run verify:kelly-rails-cloudrun --prefix middleware-platform`
- [x] Local: `KELLY_RAILS_ENV_PROFILE=staging KELLY_RAILS_V2=1 npm run verify:kelly-rails-env --prefix middleware-platform`
- [x] `staging:preflight` runs Kelly env verify
- [x] Runtime proof: `kelly_call_events.turn_resolved` with `payload_json.runtime=kelly_rails_v2`

**Evidence (F2 E7-1, 2026-06-02):**

| Artifact | Value |
|----------|--------|
| Session | `e2e_conversation_1780428787097_b5571fe6` |
| F2 scorecard | **12/12 non-skipped PASS** (exit 0), `npm run test:e2e:rcm:conversation` |
| Tools (T1–T6) | `store_triage_opqrst`, `run_triage_rag`, `get_available_slots`, `request_patient_payment` |
| Runtime row | `lane=payment`, `tools_used=["request_patient_payment"]`, `created_at=2026-06-02T19:33:24.943Z` |
| Verify | `npm run verify:kelly-rails-runtime -- --session-id e2e_conversation_1780428787097_b5571fe6` |
| Staging revision | `somo-middleware-00002-zrj` (Kelly v2 env on Cloud Run; runtime row from local F2 DB aligned with v2 path) |

```sql
SELECT id, session_id, event_type, payload_json, created_at
FROM kelly_call_events
WHERE event_type = 'turn_resolved'
  AND json_extract(payload_json, '$.runtime') = 'kelly_rails_v2'
ORDER BY created_at DESC LIMIT 5;
```

**F2 runbook:** `npm run phase-b:f2-prep --prefix middleware-platform` then:

```bash
export KELLY_RAILS_V2=1 KELLY_ALLOW_HYBRID_GRAPH=0 KELLY_RAILS_ROLLOUT_PCT=1
export LANGGRAPH_KELLY_ROLLOUT_PCT=0 RCM_E2E_USE_EXISTING_SERVER=1 KELLY_RAILS_FAST_RAG=1
npm run test:e2e:rcm:conversation --prefix middleware-platform
```

Uses `RCM_E2E_DIRECT_TOOLS=1` (in-process booking/pay; no hung :4000 tool HTTP).

### Week 2–4 — Rails (code + fast tests)

- [x] Golden utterance fixture + `test:kelly:rails:golden` (46 tests)
- [x] Allow-list contract tests
- [x] Switch 3 confirmation receipt (no video/portal tools in `post_payment`)
- [x] `test:e2e:kelly:golden-conversations` — 10 conversations, 2 per rail
- [x] Pay-before-book `executeTurn` integration test
- [x] Voice payment lane test
- [x] CI: Kelly Rails Phase B step in `.github/workflows/ci.yml`
- [x] F2 green (E7-1): see evidence table above

### V6-3 — Provider dashboard

- [x] Clinical prep in-process for F2 appointment `appt-b3a1e3f4-3ef8-415e-8f0d-1b1e21797d01` (`npm run phase-b:v6-3` with `DB_PATH=./middleware-dev.db`)
- [ ] Manual: [`today.html`](../../unified-dashboard/business/today.html) activity feed (operator screenshot)
- [x] Clinical prep API path documented: `GET /api/admin/appointments/:id/clinical-prep`
- [x] Provider value does **not** depend on video/portal link (Switch 3 scope)

### Audit before merge

```bash
cd middleware-platform
node scripts/phase-b-production-gap-audit.cjs
npm run test:kelly:rails:golden
npm run test:e2e:kelly:golden-conversations
npm run test:kelly:rails:language
```

---

## Phase C — Language + voice (weeks 4–5)

**Execution SSOT:** [`KELLY_RAILS_PHASE_C_EXECUTION.md`](KELLY_RAILS_PHASE_C_EXECUTION.md)  
**Pending (sign-off + staging):** [`KELLY_RAILS_PHASE_C_PENDING.md`](KELLY_RAILS_PHASE_C_PENDING.md)

- [x] Detection SSOT: [`KELLY_RAILS_PHASE_C_LANGUAGE.md`](KELLY_RAILS_PHASE_C_LANGUAGE.md)
- [x] Unified `kelly-rails/language.js`
- [x] Tests: `npm run test:kelly:rails:language`
- [x] Spanish prompts (en/es), voice SLO, ASR gate, mismatch telemetry — see EXECUTION checklist
- [ ] Phase C sign-off — see PENDING (P0 translator/scorecards, staging proof A–F, B-OPS-01)

---

## Active execution

- **Phase B+:** [`KELLY_RAILS_PHASE_B_PLUS.md`](KELLY_RAILS_PHASE_B_PLUS.md)
- **Staging runtime row on production DB:** one Kelly chat on staging → `DB_PATH=<staging.db> npm run verify:kelly-rails-runtime`

## Sprint 4–5

Provider UI and RCM pipeline items unchanged; see git history.
