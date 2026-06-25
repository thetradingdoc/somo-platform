# Commerce 100-Scenario Test Pack — Self-Review

**Date:** 2026-06-24 (v2 PSTN Replay pass)  
**Reviewer:** Fixture authoring pass  
**Status:** v2 preparation complete — runner not implemented

---

## v2 PSTN Replay 100 — deliverables

| Artifact | Path | Status |
|----------|------|--------|
| Replay pack (SSOT) | `middleware-platform/tests/fixtures/commerce-pstn-replay-100.json` | 100 calls |
| Function coverage | `middleware-platform/tests/fixtures/commerce-pstn-function-coverage.json` | 34 functions |
| Call schema | `middleware-platform/tests/fixtures/commerce-pstn-replay-schema.json` | JSON Schema |
| Transcript book | `docs/qa/commerce-pstn-replay-100-TRANSCRIPT_BOOK.md` | Generated |
| Block authors | `middleware-platform/scripts/lib/pstn-replay/block01–07` | 7 modules |
| Generator | `middleware-platform/scripts/generate-commerce-pstn-replay-100.cjs` | JSON + coverage |
| Validator | `middleware-platform/scripts/validate-commerce-pstn-replay.cjs` | Min turns, no brackets, coverage gate |
| Transcript book gen | `middleware-platform/scripts/generate-commerce-pstn-transcript-book.cjs` | Markdown export |

### v2 realism checklist (per block)

| Block | IDs | Voice/Chat | Min turns | Agent dialogue | Tool inline | Notes |
|-------|-----|------------|-----------|----------------|-------------|-------|
| 1 | PSTN-001–015 | 15 voice | ≥12 | ✅ every agent turn | ✅ | ACK before purchase on stressed callers |
| 2 | PSTN-016–030 | 15 chat | ≥14 | ✅ | ✅ | Cart, verify, stale quote, invalid merchant |
| 3 | PSTN-031–048 | 18 voice | ≥12 | ✅ | ✅ | OPQRST triage, 911 script, Spanish |
| 4 | PSTN-049–060 | 12 voice | ≥12 | ✅ | ✅ | Outbound, cancel/reschedule failures |
| 5 | PSTN-061–068 | 8 voice | ≥12 | ✅ | ✅ | Copay, claims, mashup upsell |
| 6 | PSTN-069–080 | 11 voice + 1 chat | ≥12/14 | ✅ | ✅ | Vent/handoff before product |
| 7 | PSTN-081–100 | 17 voice + 3 chat | ≥12/14 | ✅ | ✅ | Capstone PSTN-100 full stack |

### v2 acceptance criteria

- [x] 100 entries in `commerce-pstn-replay-100.json`
- [x] Every entry: ≥12 voice or ≥14 chat turns; every turn has `text`
- [x] Zero `[bracket]` placeholder caller lines
- [x] All 34 functions in coverage matrix with minimum call counts
- [x] `validate-commerce-pstn-replay.cjs` passes
- [x] TRANSCRIPT_BOOK.md generated
- [x] v1 scenarios JSON marked `_deprecated`

### v1 disposition

`commerce-voice-100-scenarios.json` retained with `_deprecated` header. Assertion schema and supplement catalog unchanged.

---

## v1 legacy self-review (2026-06-24)

**Status:** Superseded by v2 — retained for reference only

## Deliverables checklist

| Artifact | Path | Status |
|----------|------|--------|
| Supplement catalog | `middleware-platform/tests/fixtures/commerce-supplement-catalog.json` | 8 SKUs |
| Scenario registry | `middleware-platform/tests/fixtures/commerce-voice-100-scenarios.json` | 100 scenarios |
| Assertion schema | `middleware-platform/tests/fixtures/commerce-assertion-schema.json` | 28 assertion types + F-01–F-10 |
| Speech corpus | `middleware-platform/eval/commerce-speech-golden-set.json` | 30 pairs |
| Report template | `docs/qa/COMMERCE_100_SCENARIO_REPORT_TEMPLATE.md` | AQS + failure log |
| Runner spec | `docs/testing/COMMERCE_100_SCENARIO_RUNNER_SPEC.md` | Future terminal runner |
| Fixture generator | `middleware-platform/scripts/generate-commerce-100-scenarios-fixture.cjs` | Regenerate JSON |

---

## Scenario coverage verification

| Category | Planned | Authored | IDs |
|----------|---------|----------|-----|
| commerce_purchase | 18 | 18 | C-001–C-018 |
| commerce_complaint | 12 | 12 | C-019–C-030 |
| vent_handoff | 10 | 10 | C-031–C-040 |
| non_transactional | 8 | 8 | C-041–C-048 |
| booking | 10 | 10 | C-049–C-058 |
| cancel_reschedule | 8 | 8 | C-059–C-066 |
| appointment_payment | 8 | 8 | C-067–C-074 (C-073 skip) |
| outbound | 8 | 8 | C-075–C-082 |
| speech_asr | 10 | 10 | C-083–C-092 |
| frontend | 10 | 10 | C-093–C-100 |
| **Total** | **100** | **100** | |

### Channel distribution

| Channel | Count |
|---------|-------|
| voice | 62 |
| chat | 24 |
| both | 2 (C-006, C-057) |
| chat_ui | 10 |
| skip (C-073) | 1 |

---

## Five-dimension coverage

### 1. Acknowledgement

| Requirement | Scenarios | Assertion |
|-------------|-----------|-----------|
| Empathy before transaction | C-001, C-004, C-008, C-034, C-038 | ACK_BEFORE_TRANSACTION |
| Vent → handoff not product pitch | C-031–C-035, C-036–C-040 | VENT_HANDOFF, ACK_NOT_SCHEDULING_JUMP |
| No bot therapy | C-025, C-033, C-039, C-043 | NO_BOT_THERAPY |
| Mixed vent + buy ack first | C-034 | ACK_BEFORE_TRANSACTION |

**Gap noted:** Commerce lane (`_processCommerceCheckoutTurn`) has no dedicated ack gate — failures will map to `kelly-agent-service.js`.

### 2. Agent state

| Store | Scenarios with assertions |
|-------|---------------------------|
| `checkout_stage` FSM | C-001, C-013, C-015, C-020, C-026 |
| `meta_kv` commerce keys | C-001, C-011, C-013 |
| `kelly_rails_session_projection` | C-040, C-052, C-057 |
| `commerce_carts` | C-002, C-003, C-009, C-028 |
| `kelly_call_events` | C-004, C-018, C-040, C-053, C-067, C-070 |

**Cross-cut:** All transactional scenarios include `TOOL_COMPLETED_BEFORE_CLAIM` where applicable.

### 3. Speech metrics

| Metric | Scenarios |
|--------|-----------|
| WER/CER (batch) | C-089 + 30 corpus pairs |
| EOT latency | C-083, C-085, C-088, C-091 |
| ASR confidence / clarify | C-083, C-084, C-092 |
| RTF + assistant latency | C-090, C-087 |
| Spanish / locale | C-048, C-055, C-086 |
| Voice SLO | C-037, C-048, C-055, C-087 |

**N/A documented:** OOV, SNR suites, diarization — per SPEECH_METRICS_ROADMAP Phase 3.

### 4. Booking, cancel, reschedule, payments

| Flow | Scenarios |
|------|-----------|
| Book | C-049–C-058 |
| Cancel | C-059, C-061, C-062, C-064, C-066 |
| Reschedule | C-060, C-063, C-065 |
| Appointment payment | C-067–C-072, C-074 |
| Product payment | C-001–C-018, C-074 |
| Emergency block | C-058 |

### 5. Failure recording

Every scenario includes `failure_codes` where P0 risk exists. Report template defines per-assertion row with `code_primary`, `code_secondary`, `telemetry_gap`, `severity`.

---

## Dual-stack gap cross-check

| Architectural risk | Scenarios that expose it | Tagged |
|--------------------|--------------------------|--------|
| No retail Kelly Rails subrail | All commerce_purchase — bypass via `commerceCheckout` | Documented in runner spec |
| Tool manifest mismatch (voice) | C-004, C-012 | F-02, predicted_failure_refs |
| Payment surface split (SMS vs PI) | C-006, C-013, C-095 | F-01, F-10 |
| No commerce vent subrail | C-031–C-035 | F-03 |
| No cancel_order tool | C-019–C-024 | F-07 |
| No supplement reorder outbound | C-076 | F-05 |
| No Playwright UI tests | C-093–C-100 | F-06 |
| State collision voice+chat | C-057 | F-08 |
| WER corpus was small | C-089 | F-09 (now 30 pairs) |

---

## Predicted failures F-01–F-10 mapping

| ID | Scenarios tagged `predicted_failure_refs` | Assertion / failure_code |
|----|------------------------------------------|--------------------------|
| F-01 | C-006 | PRICE_PARITY_MISMATCH |
| F-02 | C-004, C-012 | VOICE_TOOL_MANIFEST_GAP |
| F-03 | C-031, C-032, C-033, C-034, C-035 | HANDOFF_NOT_TRIGGERED, PRODUCT_PITCH_ON_VENT |
| F-04 | C-034, C-038 | COMMERCE_NO_ACK |
| F-05 | C-076 | OUTBOUND_COMMERCE_RAIL_MISSING |
| F-06 | C-093–C-100 | (UI runner gap) |
| F-07 | C-019, C-021, C-022 | NO_CANCEL_ORDER_TOOL |
| F-08 | C-057 | STATE_COLLISION |
| F-09 | C-089 | WER_REGRESSION |
| F-10 | C-013, C-100 | CHECKOUT_FAILED_UI_SILENT, QUOTE_STALE_UI_MISSING |

**Validation:** All 10 predicted failures have ≥1 scenario with `predicted_failure_refs`. F-06 covers all 8 frontend scenarios.

---

## Per-scenario completeness audit (sample)

| Check | Result |
|-------|--------|
| Every scenario has `id`, `title`, `channel`, `category` | PASS (100/100) |
| Every scenario has `transcript` OR `skip_reason` | PASS (C-073 skip only) |
| Emotional scenarios have ack/handoff assertions | PASS (C-031–C-040, C-021–C-025) |
| Commerce purchase has tool_expectations | PASS (18/18) |
| Voice commerce has speech_metrics | PASS (excl. chat_ui) |
| Frontend has ui_assertions | PASS (10/10) |
| P0 scenarios marked `priority: P0` | C-001, C-002, C-003, C-004, C-006, C-013, C-015, C-017, C-030, C-031, C-038, C-054, C-058, C-067 |

---

## Baseline Agent Quality Score (predicted, not executed)

| Dimension | Predicted readiness | Weighted contribution |
|-----------|---------------------|----------------------|
| commerce_purchase | 52% | 0.13 |
| commerce_complaint | 35% | 0.05 |
| acknowledgement_handoff | 38% | 0.06 |
| agent_state | 45% | 0.07 |
| speech_metrics | 40% | 0.04 |
| booking_cancel_payment | 68% | 0.07 |
| frontend | 22% | 0.02 |
| **AQS (predicted)** | **~41%** | |

**Interpretation:** Without running tests, the agent is **Not ready** for 24/7 supplement commerce. Highest-confidence existing coverage is chat happy-path (maps to `test-commerce-checkout-agent.js`). Highest risk is vent handoff + voice commerce dual-stack + frontend UI.

**Target after fixes + test pass:** AQS ≥ 85% (Production commerce grade).

---

## Recommended P0 scenario subset for first runner implementation

When implementing the runner, execute this subset first (15 scenarios):

1. C-001 — chat full checkout FSM  
2. C-004 — voice search + create_checkout  
3. C-006 — price parity  
4. C-030 — invalid merchant blocked  
5. C-031 — vent handoff  
6. C-038 — ack before quote  
7. C-049 — routine booking  
8. C-054 — no false confirm  
9. C-058 — emergency block  
10. C-067 — copay link  
11. C-075 — outbound reminder  
12. C-083 — low confidence clarify  
13. C-089 — WER batch  
14. C-093 — UI quote load  
15. C-100 — stale quote UI  

---

## Sign-off

- [x] 100 scenarios authored with transcripts and assertions  
- [x] Catalog, schema, speech corpus, report template, runner spec complete  
- [x] F-01–F-10 cross-checked against scenarios  
- [x] Dual-stack gaps documented  
- [ ] Runner implemented (deferred)  
- [ ] Live test execution (deferred)
