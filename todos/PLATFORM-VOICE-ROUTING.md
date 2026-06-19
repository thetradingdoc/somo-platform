# PLATFORM-VOICE — master tracker (64 IDs)

Epic: **PLATFORM-VOICE** — Ingress (world) → L2 (mode) → L4 (rails/gate).

**Site + escalation epic:** [VOICE-SITE-ESC-EPIC.md](./VOICE-SITE-ESC-EPIC.md) (L1.5 CallSiteContext, handoff escalations, REL/VFY).

Legend: ✅ done · ⚠️ partial · ❌ not started

## PD — Product & architecture

| ID | Status | Notes |
|----|--------|-------|
| PD-1 | ✅ | `docs/voice/PLATFORM_NUMBER_INBOUND_SPEC.md` |
| PD-2 | ✅ | Outbound stages in `docs/deployment/VOICE_OPERATOR_BILLING.md` |
| PD-3 | ✅ | Number map in `docs/runbooks/OPERATIONS.md` |
| PD-4 | ⚠️ | Subsumed by VOICE-SITE-ESC VFY-01; matrix smoke + live verify |
| PD-5 | ✅ | Lead journey in spec + LX items |

## R — Identity & routing

| ID | Status | Notes |
|----|--------|-------|
| R-1 | ✅ | Audit doc in `docs/voice/R-1-PLATFORM-LINE-AUDIT.md` |
| R-2 | ✅ | `shouldBlockKellyTurn` + demo early exit |
| R-3 | ✅ | WS backfill `customer_id`, `call_type`, `to/from` from DV |
| R-4 | ✅ | `isSomoDemoDemoConnection` + `to_number` |
| R-5 | ✅ | Fail-closed + Kelly block + tool firewall |
| R-5b | ✅ | `isTenantResolvedForMode` in WS, turn-resolver, incoming |
| R-5c | ✅ | `platform_support` in resolver + routing world |
| R-6 | ✅ | Platform-support admin+handoff, triage disabled |
| R-7 | ⚠️ | Document split-DID env in OPERATIONS; prod may share number |
| R-8 | ✅ | `routing_world_resolved` events |

## I — Intent hygiene

| ID | Status |
|----|--------|
| I-1 | ✅ |
| I-2 | ✅ |
| I-3 | ✅ |
| I-4 | ✅ |
| I-5 | ✅ |
| I-6 | ✅ |
| I-7 | ✅ |

## L — L4 belt guards

| ID | Status |
|----|--------|
| L-1 | ✅ |
| L-2 | ✅ |
| L-3 | ✅ |
| L-4 | ✅ |
| L-5 | ✅ |

## D — Demo path

| ID | Status | Notes |
|----|--------|-------|
| D-1 | ✅ | Opener uses Somo branding |
| D-2 | ✅ | Demo tools only; firewall blocks triage |
| D-3 | ⚠️ | Smoke asserts; full E2E optional |
| D-4 | ⚠️ | `request-call` sets `somo_demo` in handler |
| D-5 | ✅ | VALUE→CTA on clinical phrases |

## O — Operator outbound

| ID | Status |
|----|--------|
| O-1 | ✅ |
| O-2 | ✅ |
| O-3 | ⚠️ | Register path exists; verify in prod |
| O-4 | ✅ |

## T — Tenant DID

| ID | Status |
|----|--------|
| T-1 | ⚠️ | SAAS_VOICE_FAIL_CLOSED exists |
| T-2 | ✅ |
| T-3 | ✅ |
| T-4 | ✅ |

## V — Verification

| ID | Status |
|----|--------|
| V-1 | ✅ |
| V-2 | ✅ |
| V-3 | ⚠️ | Manual matrix in OPERATIONS |
| V-4 | ✅ | `scripts/voice-routing-matrix-smoke.cjs` |
| V-5 | ✅ | `docs/testing/TESTING.md` |

## LX — Lead UX

| ID | Status | Notes |
|----|--------|-------|
| LX-1 | ✅ | Demo off-script handoff |
| LX-2 | ✅ | Warm team-call CTA |
| LX-3 | ⚠️ | Post-call email/SMS on end_call |
| LX-4 | ⚠️ | Outbound opener uses lead context |
| LX-5 | ✅ | Voicemail branch (O-2) |
| LX-6 | ✅ | Opt-out demo + operator |
| LX-7 | ❌ | Outbound time guard — backlog |
| LX-8 | ✅ | `capturePartialDemoSession` |
| LX-9 | ✅ | Bilingual demo replies |
| LX-10 | ⚠️ | `somo_demo_requests` admin exists |
| LX-11 | ❌ | Retry policy — backlog |
| LX-12 | ❌ | WS reconnect — backlog |
| LX-13 | ✅ | `trimDemoReply` ~25 words |

## CR+ — Backlog amendments

| ID | Status |
|----|--------|
| CR-052+ | ✅ |
| CR-026+ | ✅ |
| CR-040+ | ✅ (documented) |
| CR-022+ | ✅ |
| FE-003+ | ✅ |

## DOC

| ID | Status |
|----|--------|
| DOC-1 | ✅ |
| DOC-2 | ✅ |
| DOC-3 | ✅ |
| DOC-4 | ✅ |
| DOC-5 | ✅ |

## Definition of done

- [x] Platform inbound resolves `routing_world`
- [x] Booking/email never false OPQRST (unit + smoke)
- [x] Demo path blocks Kelly / triage tools
- [x] Operator voicemail/opt-out handled
- [ ] Live verify PD-4 on `+13639990205`
- [x] `routing_world` in provider call detail UI

## Verify

```bash
cd middleware-platform
npm run smoke:voice-routing-matrix
npm test -- --testPathPattern="platform-voice|operator-outbound|intent-detector-clinical"
```
