# VOICE-SITE-ESC — Site context + escalation epic

**Epic:** CallSiteContext (L1.5) + escalation ladder + REL/VFY  
**Plan:** `.cursor/plans/voice_site_escalation_epic_eeb9cbc1.plan.md`  
**Post-review plan:** `.cursor/plans/epic_review_follow-up_431ede5b.plan.md`  
**Legend:** ⬜ pending · 🔄 in progress · ✅ done · ⚠️ partial / gated

## REL — Release hygiene

| ID | Status | Notes |
|----|--------|-------|
| REL-01 | ✅ | Commit + OPERATIONS revision doc |
| REL-02 | ✅ | Revision reconcile in runbook |
| REL-03 | ✅ | Minimal `.github/workflows/ci.yml` |
| REL-04 | ✅ | Migration 061 `kelly_call_events` |
| REL-05 | ⬜ | Prod GCS migration verify (operator — runbook in OPERATIONS) |
| REL-06 | ⚠️ | Staging enforce defaults in generator; live Cloud Run verify pending |
| REL-07 | ⚠️ | TENANT_INBOUND_ADMIN enforce on staging — verify after deploy |
| REL-08 | ✅ | Deploy post-step smoke |

## SITE — Site bleed

| ID | Status | Notes |
|----|--------|-------|
| SITE-01 | ✅ | `call-site-context.js` |
| SITE-02 | ✅ | status rules + smoke |
| SITE-03 | ✅ | ingress metadata |
| SITE-04 | ✅ | WS hydration reorder |
| SITE-05 | ✅ | tool firewall gate |
| SITE-06 | ✅ | routing_world unchanged |
| SITE-07 | ✅ | `call_site_context_resolved` event |
| SITE-08 | ✅ | migration 062 |
| SITE-09 | ✅ | getCustomerIdForClinic |
| SITE-10 | ✅ | migration 063 |
| SITE-11 | ✅ | migration 064 customer_clinics |
| SITE-12 | ⚠️ deferred | `location_id` field only — no resolver / `clinic_locations` |
| SITE-20 | ✅ | migration 065 projection |
| SITE-21 | ✅ | migration 066 triage |
| SITE-22 | ✅ | store_triage gate |
| SITE-23 | ✅ | backfill script |
| SITE-24 | ✅ | indexes |
| SITE-25 | ⚠️ | migration 067 index phase; 074 preflight + verify script (NOT NULL after backfill) |
| SITE-30 | ✅ | reconnect ADR + orchestrate sync |
| SITE-31 | ✅ | hydrateSessionForTurn |
| SITE-32 | ⚠️ partial | meta-kv-policy phase 1; full `_setSessionMeta` audit deferred |

## ESC — Escalation

| ID | Status | Notes |
|----|--------|-------|
| ESC-01 | ✅ | migration 068 clinic PSTN |
| ESC-02 | ✅ | migration 069 handoff_escalations |
| ESC-03 | ✅ | transfer_call executor + WS switch |
| ESC-04 | ✅ | escalation-service.js |
| ESC-05 | ✅ | handoff wiring |
| ESC-06 | ✅ | emergency-safety.js |
| ESC-07 | ✅ | agentBlocked single-frame transfer |
| ESC-08 | ✅ | TwiML Dial |
| ESC-09 | ✅ | fail_closed_escalation event |
| ESC-10 | ✅ | calls.html UI |
| ESC-11 | ✅ | ER copy no PSTN |
| ESC-12 | ⚠️ | Retell transfer — code complete; **T-001** staging PSTN ring gate |

## VFY — Verification

| ID | Status | Notes |
|----|--------|-------|
| VFY-01 | ✅ | voice-routing-matrix-live.cjs + `--tenant-book` / `--fail-closed` |
| VFY-02 | ✅ | ci-local smoke |
| VFY-03 | ⬜ | live tenant book proof (`--tenant-book`) |
| VFY-04 | ⬜ | live fail-closed proof (`--fail-closed`) |
| VFY-05 | ✅ | negative unit test |
| VFY-06 | ⬜ | Kelly Phase C Spanish (separate) |

## Post-epic gaps (T-001–T-018)

| ID | Status | Notes |
|----|--------|-------|
| T-001 | ⚠️ | Manual Retell transfer gate — ring **skipped** by operator; WS frame pass logged |
| T-002–T-004 | ✅ | Single-frame Retell transfer + emergency-safety + identity path |
| T-005 | ✅ | migration 070 + scoped `getFHIRPatientByPhone` |
| T-006 | ✅ | migration 071 + case_records / session_state_projection tenant cols |
| T-007 | ✅ | migration 072 + per-clinic voice settings |
| T-008 | ⚠️ deferred | SITE-12 location_id |
| T-009 | ✅ | orchestrate sync + ADR |
| T-010 | ⚠️ partial | meta-kv-policy phase 1 |
| T-011 | ✅ | verify-tenant-columns-null-free.cjs + migration 074 preflight |
| T-012 | ✅ | outbound site gate + smoke |
| T-013–T-014 | ⬜ | live verify flags (operator) |
| T-015–T-016 | ⬜ | staging/prod deploy sequence — OPERATIONS |
| T-017 | ✅ | tracker honesty (this file) |
| T-018 | ✅ | retell-transfer.test.js |

**Epic status:** ⚠️ Code complete for post-review train — operator steps T-001, REL-05, VFY-03/04, T-015/16 remain.

**Remediation train:** [VOICE-REMEDIATION-TRAIN.md](./VOICE-REMEDIATION-TRAIN.md) (R-01–R-13)

## Verify

```bash
cd middleware-platform
npm run smoke:voice-routing-matrix
npm test -- --testPathPattern="call-site-context|escalation|transfer-call|retell-transfer|fhir-patient|case-records|voice-settings|meta-kv"
node scripts/verify-tenant-columns-null-free.cjs --check-only
```
