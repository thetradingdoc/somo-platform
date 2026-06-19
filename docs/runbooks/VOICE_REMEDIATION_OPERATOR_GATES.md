# Operator gates — voice remediation (R-11)

**SSOT:** [VOICE-REMEDIATION-TRAIN.md](../../todos/VOICE-REMEDIATION-TRAIN.md)

## T-001 — Retell transfer staging gate

**Owner:** operator · **Blocks:** live tenant escalation

| Step | Action | Pass |
|------|--------|------|
| 1 | Configure staging clinic `transfer_number` (migration 068) or `CALLSOMO_OPERATOR_FALLBACK_PSTN` | Documented in run log |
| 2 | External PSTN → staging tenant DID | Call connects |
| 3 | Force escalation: unidentified DID, `agentBlocked`, or `transfer_call` tool | Escalation path fires |
| 4 | Retell dashboard: transfer event; WS frame has `transfer_number` + `no_interruption_allowed` | Screenshot / `call_id` |
| 5 | Callee PSTN rings and is answerable | **Required** |
| 6 | Log in [OPERATIONS.md](../runbooks/OPERATIONS.md) § T-001: `call_id`, date, operator name | Audit trail |

If step 5 fails → eng implements R-06-4 REST fallback and re-run.

## PD-4 — Live routing matrix (5 worlds)

Offline `voice-routing-matrix-smoke.cjs` does **not** close PD-4.

| ID | World | Live call | Assert (within 10s) |
|----|-------|-----------|------------------------|
| R-11-1 | demo | Platform demo DID | `routing_world_resolved` = demo |
| R-11-2 | tenant | Tenant inbound DID | tenant + site verified |
| R-11-3 | unidentified | Unknown DID | fail-closed handoff |
| R-11-4 | platform_support | Support line | admin + handoff, no OPQRST |
| R-11-5 | operator_outbound | Outbound test | `site_context_status` = not_required |

```bash
cd middleware-platform
node scripts/voice-routing-matrix-live.cjs --pull-db --latest --session call_XXX
node scripts/voice-routing-matrix-live.cjs --tenant-book --session call_XXX
node scripts/voice-routing-matrix-live.cjs --fail-closed --session call_XXX
```

## CR live journey scripts (operator)

| ID | Command |
|----|---------|
| R-11-6 | `npm run verify:live-booking-call` |
| R-11-7 | `npm run verify:live-cancel-call` |
| R-11-8 | `npm run verify:live-reschedule-call` |
| R-11-9 | `npm run verify:same-day-cancel-rebook` |
| R-11-10 | `npm run verify:live-copay-call` |
| R-11-11 | `npm run verify:live-visit-checkout` |

## R-09 — Kelly Phase C Spanish (clinical + operator)

See [KELLY_PHASE_C_STAGING.md](../runbooks/KELLY_PHASE_C_STAGING.md) and PENDING.md § Kelly Phase C.

**Gate:** No `KELLY_RAILS_ES_ENABLED=1` in prod until `OPQRST_ES_SIGNOFF_*.md` exists and ES cohort (R-09-4) passes.

## R-10 — Outbound go-live gate

**Blocks:** tenant outbound rail live until quiet hours (LX-7) and retry cap (LX-11) verified on staging.

```bash
cd middleware-platform
npm run smoke:operator-outbound
```
