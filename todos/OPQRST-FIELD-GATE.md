# OPQRST Field Gate — implementation checklist

Tracking copy of the implementation plan. **Do not edit the Cursor plan file** — update this file as work completes.

## Status: **Complete** (2026-06-18)

**Cloud Run:** `somo-middleware-00076-6sr` · `OPQRST_FIELD_GATE_ENABLED=1`  
**Sign-off:** [`docs/clinical/OPQRST_FIELD_GATE_SHIP_SIGNOFF_2026-06-18.md`](../docs/clinical/OPQRST_FIELD_GATE_SHIP_SIGNOFF_2026-06-18.md)

### Block 0 — Policy
- [x] P-0 `OPQRST_PROVOCATION_POLICY.md`
- [x] P-1 Kelly prompt — optional provocation unless `triage_policy: required`
- [x] P-2 Unified `opqrstComplete()` in `opqrst-field-gate.js`

### Block A — Completion audit
- [x] A-1 `OPQRST_COMPLETION_AUDIT.md`
- [x] A-1 `kelly-tool-executor.js` `_storeTriageOpqrst`
- [x] A-1 `gates/shared.js`
- [x] A-1 `execute-turn.js` `promoteBookingWhenReady`
- [x] A-1 `state-schema.js` `routeOrchestratorLane`
- [x] A-1 `gates/opqrst.js` + `clinical.js`
- [x] A-1 `voice-triage-guards.js`
- [x] A-1 `kelly-orchestrator-phase.js`
- [x] A-1 `kelly-agent-service.js` capture guard
- [x] A-2 No duplicate `opqrstComplete` in `execute-turn.js`
- [x] A-3 `opqrst-complete-parity.test.js` (13 tests)

### Block F — Rollback / feature flag
- [x] F-1 `isOpqrstFieldGateEnabled()` in `config.js` (default **on**; rollback `=0`)
- [x] F-1 Flag 0 → legacy at six call sites
- [x] F-1 Flag 1 → gate drives C-1…C-6
- [x] F-2 Staging/prod deploy + burn-in (rev `00076-6sr`)
- [x] F-3 Runbook in `OPERATIONS.md`

### Block G — OpqrstFieldGate module
- [x] G-1 `opqrst-field-gate.js` — `resolve()`, SSOT `triageRow`
- [x] G-1 Inputs / outputs per plan
- [x] G-2 Scripted lines from registry by `openField` + specialty
- [x] G-3a–G-3e Classification (tangent, answer, mixed, ambiguous, meta)
- [x] G-4 No `hasSymptomNow` when gate on; last-assistant field context

### Block C — Six call sites
- [x] C-1 `voice-reply-formatter.js`
- [x] C-1 `retell-websocket.js` threads `_opqrst_gate`
- [x] C-1 voice history wiring — `appendHistory` + `getLastAssistantText` (T-7)
- [x] C-2 `kelly-agent-service.js` capture guard
- [x] C-3 `tool-allowlists.js` (L4)
- [x] C-4 `mode-tool-firewall.js` (L2)
- [x] C-5 `node-runner.js`
- [x] C-6 `execute-turn.js` resolve + idempotent store
- [x] C-6 Reroute preserves partial triage

### Block R — Pivot durability
- [x] R-1 `opqrst_resume_field` in `session-ssot.js`
- [x] R-2 `pivot-engine.js` billing pivot saves `openField`
- [x] R-3 Return to clinical restores resume field
- [x] R-4 `opqrst-subrail.js` DB sync
- [x] R-5 `opqrst-billing-pivot-frequency.cjs`
- [x] R-5a Thresholds + recorded decision (0% `same_train_ok`)

### Block D — De-couple L4 step
- [x] D-1 Registry hints `null` when gate on
- [x] D-2 `lanes.js` phase-based advance via `opqrstComplete(row)`
- [x] D-3 DB-led accumulator in subrail

### Block T — Tests
- [x] T-1 Core (4 cases)
- [x] T-1b Cases 1–10
- [x] T-2 `voice-reply-formatter.test.js`
- [x] T-3 Pivot survival
- [x] T-4 `tenant-billing-pivot-smoke` V6–V9
- [x] T-5 `run-patient-tests.sh` provocation handler
- [x] T-6 Idempotency test
- [x] T-7 `opqrst-voice-history-wiring.test.js` + `opqrst-voice-dod-smoke.cjs --with-history`

### Block M — Metrics
- [x] M-1 `opqrst.field_stored`
- [x] M-2 `opqrst.tangent_detected`
- [x] M-3 `opqrst.script_suppressed`
- [x] M-4 `opqrst.repeat_blocked`
- [x] M-5 `opqrst.gate_enabled` / `gate_bypassed`
- [x] M-6 Runbook debug steps

### Block DOC + specialty
- [x] DOC-1 `OPQRST_FIELD_GATE_ARCHITECTURE.md`
- [x] DOC-2 Cross-ref `PENDING.md` C-P0
- [x] DOC-3 Covered by T-6
- [x] Specialty tenant-policy documented
- [ ] specialty-policy-pr2 optional derm heuristic removal (deferred)

### Deferred / cancelled
- L-1 ES tangent patterns (cancelled)
- Block 8 legacy processTurn / enforce / ES prod (cancelled)

## Verification

```bash
cd middleware-platform
OPQRST_FIELD_GATE_ENABLED=1 npm run test:opqrst-field-gate   # 38 passed
OPQRST_FIELD_GATE_ENABLED=0 npm run test:opqrst-field-gate   # 38 passed
npm run test:opqrst-field-gate:standalone                     # 25 passed (T-1/T-1b/T-2/T-3/T-6)
npm run smoke:tenant-billing-pivot
npm run test:opqrst-voice-history
npm run smoke:opqrst-voice-dod
node scripts/opqrst-voice-dod-smoke.cjs --with-history
npm run smoke:opqrst-phase-c-en
DB_PATH=/tmp/middleware-staging.db npm run verify:opqrst-ship
```

## Key files

- `middleware-platform/services/opqrst-field-gate.js`
- `middleware-platform/services/kelly-rails/config.js`
- `middleware-platform/services/voice-reply-formatter.js`
- `docs/clinical/OPQRST_PROVOCATION_POLICY.md`
- `docs/runbooks/OPERATIONS.md`
