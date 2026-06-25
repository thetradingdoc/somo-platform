# Commerce 100-Scenario Test Report

**Run ID:** `RUN-YYYY-MM-DD-HHMM`  
**Date:** YYYY-MM-DD  
**Operator:**  
**Environment:** `local` | `staging` | `production`  
**API revision:** Cloud Run revision or git SHA  
**Merchant:** `merchant_c3d547a10f43eeec`  
**Fixture version:** `commerce-voice-100-scenarios.json` v1.0.0  

---

## Executive summary

| Metric | Value |
|--------|-------|
| Scenarios executed | / 100 |
| Scenarios skipped | |
| Assertions passed | / |
| Assertions failed | |
| **Overall pass rate** | % |
| **Agent Quality Score (AQS)** | % |
| **Grade** | Not ready / Beta / Pilot / Production commerce |
| Baseline predicted AQS (pre-run) | 41% |
| Target AQS | ≥ 85% |

**Grade bands**

| AQS | Grade |
|-----|-------|
| &lt; 50% | Not ready |
| 50–69% | Beta |
| 70–84% | Pilot |
| ≥ 85% | Production commerce |

---

## Agent Quality Score (AQS)

```
category_pass_rate = passed_assertions / total_assertions in category

AQS =
  0.25 × commerce_purchase_pass
+ 0.15 × commerce_complaint_pass
+ 0.15 × acknowledgement_handoff_pass
+ 0.15 × agent_state_pass
+ 0.10 × speech_metrics_pass
+ 0.10 × booking_cancel_payment_pass
+ 0.10 × frontend_pass
```

### Category breakdown

| Category | Scenarios | Assertions | Passed | Pass % | Weight |
|----------|-----------|------------|--------|--------|--------|
| commerce_purchase (C-001–C-018) | 18 | | | | 0.25 |
| commerce_complaint (C-019–C-030) | 12 | | | | 0.15 |
| vent_handoff (C-031–C-040) | 10 | | | | 0.15 |
| agent_state (cross-cut) | | | | | 0.15 |
| speech_asr (C-083–C-092) | 10 | | | | 0.10 |
| booking + cancel + payment (C-049–C-074) | 26 | | | | 0.10 |
| frontend (C-093–C-100) | 8 | | | | 0.10 |
| non_transactional (C-041–C-048) | 8 | | | | (included in ack) |
| outbound (C-075–C-082) | 8 | | | | (included in booking) |

**Computed AQS:** ___%

---

## Speech metrics summary (Table 2)

| Metric | Threshold | Mean | P95 | Fail count | Notes |
|--------|-----------|------|-----|------------|-------|
| WER | ≤ 15% | | | | `commerce-speech-golden-set.json` |
| CER | — | | | | |
| SER | — | | | | |
| EOT latency (clean) | ≤ 800 ms | | | | |
| EOT latency (noisy) | ≤ 1200 ms | | | | |
| RTF | &lt; 1.0 | | | | |
| Assistant latency | ≤ 2500 ms | | | | |
| STT confidence | ≥ 0.75 clean | | | | |
| Voice SLO (TTFHR, brevity) | `VOICE_SLO_*` | | | | |
| OOV / SNR / Diarization | N/A Phase 3 | — | — | — | Record skip reason |

---

## Acknowledgement + handoff summary

| Check | Pass | Fail | Notes |
|-------|------|------|-------|
| ACK_BEFORE_TRANSACTION | | | Empathetic prefix before price/tool |
| ACK_NOT_SCHEDULING_JUMP | | | No booking on vent-only |
| VENT_HANDOFF | | | Handoff within 3 vent turns |
| NO_BOT_THERAPY | | | No clinical counseling on vent |

---

## Agent state summary

| Store | Checks | Pass | Fail |
|-------|--------|------|------|
| `checkout_stage` FSM | | | |
| `kelly_session_meta_kv` | | | |
| `kelly_rails_session_projection` | | | |
| `commerce_carts` | | | |
| `kelly_call_events` | | | |

---

## Predicted failures validation (F-01–F-10)

| ID | Scenarios | Predicted | Observed on run? | Actual failure? |
|----|-----------|-----------|------------------|-----------------|
| F-01 | C-006 | Voice vs chat price mismatch | ☐ Yes ☐ No | |
| F-02 | C-004, C-012 | Retell manifest tool gap | ☐ Yes ☐ No | |
| F-03 | C-031–C-035 | Vent → product pitch | ☐ Yes ☐ No | |
| F-04 | C-038, C-034 | No ack before quote | ☐ Yes ☐ No | |
| F-05 | C-076 | Reorder outbound missing | ☐ Yes ☐ No | |
| F-06 | C-093–C-100 | No Playwright UI coverage | ☐ Yes ☐ No | |
| F-07 | C-019–C-024 | No cancel_order tool | ☐ Yes ☐ No | |
| F-08 | C-057 | State collision voice+chat | ☐ Yes ☐ No | |
| F-09 | C-089 | WER corpus gap | ☐ Yes ☐ No | |
| F-10 | C-013 | Failed stage UI silent | ☐ Yes ☐ No | |

---

## Failure log (fill one row per failed assertion)

| scenario_id | assertion_id | reason | observed | expected | code_primary | code_secondary | telemetry_gap | severity |
|-------------|--------------|--------|----------|----------|--------------|----------------|---------------|----------|
| C-038 | ACK_BEFORE_TRANSACTION | Agent quoted price without acknowledgement | | empathetic prefix regex | `middleware-platform/services/kelly-agent-service.js` | `buildCommerceCheckoutSystemPrompt` | | P0 |
| | | | | | | | | |

### Failure code reference

| failure_code | Meaning | Typical code path |
|--------------|---------|-------------------|
| COMMERCE_NO_ACK | No empathy before transaction | `kelly-agent-service.js` |
| HANDOFF_NOT_TRIGGERED | Vent without handoff | `handoff-subrail.js` |
| PRODUCT_PITCH_ON_VENT | Sold on vent call | `kelly-rails/prompts/en.js` |
| CHECKOUT_STAGE_REGRESSION | Invalid stage transition | `checkout-context.js` |
| PRICE_PARITY_MISMATCH | Voice/chat price differ | `voice-appointments.js` / `public-commerce-quote.js` |
| VOICE_TOOL_MANIFEST_GAP | Tool in WS not in Retell JSON | `retell-functions.json` |
| NO_CANCEL_ORDER_TOOL | Cannot cancel supplement order | `retell-functions.json` |
| STATE_COLLISION | Parallel voice+chat sessions | `kelly-agent-service.js` |
| FALSE_BOOKING_CONFIRM | Confirmed without tool | `gates/schedule.js` |
| OUTBOUND_COMMERCE_RAIL_MISSING | No refill outbound rail | `operator-outbound-rail.js` |
| QUOTE_STALE_UI_MISSING | Stale quote UX | `checkout-chat.js` |
| CHECKOUT_FAILED_UI_SILENT | failed stage not shown | `patient-checkout-chat-service.js` |

---

## Per-scenario results (summary table)

| ID | Title | Channel | Status | Failed assertions |
|----|-------|---------|--------|-------------------|
| C-001 | Single SKU Vitamin D3 | chat | ☐ PASS ☐ FAIL ☐ SKIP | |
| C-002 | Browse 3 supplements | chat | ☐ PASS ☐ FAIL ☐ SKIP | |
| … | | | | |
| C-100 | Quote stale UI | chat_ui | ☐ PASS ☐ FAIL ☐ SKIP | |

_Full scenario definitions: [`middleware-platform/tests/fixtures/commerce-voice-100-scenarios.json`](../../middleware-platform/tests/fixtures/commerce-voice-100-scenarios.json)_

---

## Frontend agent (checkout-chat) results

| ID | UI check | Status | Screenshot / trace |
|----|----------|--------|-------------------|
| C-093 | Product strip + quote | | |
| C-094 | SSE turn stream | | |
| C-095 | Stripe PI modal | | |
| C-096 | Cart count | | |
| C-097 | Degraded catalog | | |
| C-098 | sessionStorage journey | | |
| C-099 | Analytics events | | |
| C-100 | Quote stale retry | | |

---

## Recommendations (post-run)

1. **P0 fixes** (block 24/7 supplement sales):
2. **P1 fixes** (pilot quality):
3. **P2 polish**:

---

## Artifacts attached

- [ ] `commerce-run-RUN-ID.json` (machine-readable results)
- [ ] `kelly_call_events` export for failed sessions
- [ ] Retell recording URLs (voice scenarios)
- [ ] Playwright traces (UI scenarios)

**Archive path:** `docs/qa/commerce-reviews/YYYY-MM-DD-RUN-ID.md`
