# Commerce 100-Scenario Runner Specification

**Status:** v2 fixture pipeline + live replay runner implemented.

## How to run (operator)

Run **one command per line** from the repo root (`somo/`). Do not append `#` comments to script names — npm treats `#` as part of the script name.

### Fixture pipeline (generate + validate + QA report)

```bash
npm run commerce-pstn-replay
```

Writes:
- `middleware-platform/tests/fixtures/commerce-pstn-replay-100.json`
- `middleware-platform/tests/fixtures/commerce-pstn-function-coverage.json`
- `docs/qa/commerce-pstn-replay-100-TRANSCRIPT_BOOK.md`
- `docs/qa/commerce-pstn-replay-100-VALIDATION_REPORT.md`

Individual steps:

```bash
npm run generate:commerce-pstn-replay
npm run validate:commerce-pstn-replay
```

### Live Kelly replay (smoke / full)

**Prerequisites:** `DB_PATH`, catalog seeded (runner seeds automatically), `ANTHROPIC_API_KEY` and/or `GROQ_API_KEY` for live runs.

```bash
npm run test:commerce-pstn-replay:dry    # structural smoke, no LLM
npm run test:commerce-pstn-replay        # live smoke (10 calls)
npm run test:commerce-pstn-replay:full   # live all 100 calls
```

Reports: `docs/qa/commerce-pstn-replay-RUN-YYYYMMDD.md` and `middleware-platform/tmp/commerce-pstn-run-*.json`

```bash
node middleware-platform/scripts/run-commerce-pstn-replay.cjs \
  --filter PSTN-001,PSTN-016 \
  --channel chat \
  --report docs/qa/my-run.md
```

---

## v2 SSOT — PSTN Replay 100 (preferred)

**Fixtures (v2):**

| File | Purpose |
|------|---------|
| [`commerce-pstn-replay-100.json`](../../middleware-platform/tests/fixtures/commerce-pstn-replay-100.json) | 100 complete replayable calls (81 voice + 19 chat) |
| [`commerce-pstn-function-coverage.json`](../../middleware-platform/tests/fixtures/commerce-pstn-function-coverage.json) | Function → PSTN ID map |
| [`commerce-pstn-replay-schema.json`](../../middleware-platform/tests/fixtures/commerce-pstn-replay-schema.json) | Per-call JSON schema |
| [`commerce-pstn-replay-100-TRANSCRIPT_BOOK.md`](../qa/commerce-pstn-replay-100-TRANSCRIPT_BOOK.md) | Human QA transcript book |

**v1 deprecated:** [`commerce-voice-100-scenarios.json`](../../middleware-platform/tests/fixtures/commerce-voice-100-scenarios.json) — behavioral matrix only; not replayable.

**Generate / validate:**

```bash
cd middleware-platform
node scripts/generate-commerce-pstn-replay-100.cjs
node scripts/validate-commerce-pstn-replay.cjs
node scripts/generate-commerce-pstn-transcript-book.cjs
```

### v2 replay loop

```
FOR each scenario IN commerce-pstn-replay-100.calls:
  seed preconditions + DB catalog (commerce-supplement-catalog.json)
  sessionId = new call_id
  FOR each turn IN scenario.turns:
    IF turn.speaker == caller:
      result = runKellyTurn(sessionId, turn.text, scenario.channel)
      ASSERT agent reply matches next golden agent turn (fuzzy + regex)
      ASSERT tool_call names match golden tool_call if present on agent turn
    ELSE golden-only (agent turns are expected outputs, not fed in)
  ASSERT every name in functions_tested has tool_completed in kelly_call_events
  ASSERT end_call tool on final agent turn
```

**Voice commerce tools:** `search_products`, `create_checkout`, `get_order_tracking`, `get_available_payment_methods`  
**Chat commerce tools:** `get_product_quote`, cart tools, `prepare_commerce_checkout`, etc.  
**Appointment tools:** [`retell-functions.json`](../../middleware-platform/retell-functions/retell-functions.json) + Kelly executor

---

## v1 legacy reference

**Fixtures (v1):** [`commerce-voice-100-scenarios.json`](../../middleware-platform/tests/fixtures/commerce-voice-100-scenarios.json)  
**Report template:** [`docs/qa/COMMERCE_100_SCENARIO_REPORT_TEMPLATE.md`](../qa/COMMERCE_100_SCENARIO_REPORT_TEMPLATE.md)

---

## Purpose

Execute all 100 supplement-commerce scenarios (voice + chat + checkout-chat UI) in terminal, score assertions, emit AQS, and produce a failure log with code paths. Inspired by [`rails-conversation-sandbox.cjs`](../../middleware-platform/scripts/rails-conversation-sandbox.cjs) and [`test-commerce-checkout-agent.js`](../../middleware-platform/scripts/test-commerce-checkout-agent.js).

---

## Proposed command (future)

```bash
# From middleware-platform/
npm run test:commerce-100-scenarios

# Or directly:
node scripts/run-commerce-100-scenarios.cjs \
  --scenarios tests/fixtures/commerce-voice-100-scenarios.json \
  --catalog tests/fixtures/commerce-supplement-catalog.json \
  --report docs/qa/commerce-reviews/RUN-$(date +%Y%m%d).md \
  --filter C-001,C-004 \
  --channel voice \
  --dry-run
```

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Node 20+ | Same as middleware-platform |
| `DB_PATH` | `./var/db/middleware-dev.db` |
| Catalog seeded | Run seed step from `commerce-supplement-catalog.json` |
| `INTERNAL_JOB_TOKEN` | Matches server for HTTP assertions |
| LLM keys | `GROQ_API_KEY` and/or `ANTHROPIC_API_KEY` for Kelly turns |
| API server | `PORT=4010` isolated instance recommended |
| Stripe test mode | For C-013, C-095 payment assertions |
| Playwright | For `chat_ui` channel scenarios C-093–C-100 |

**Env bootstrap (proposed):**

```bash
export DB_PATH=./var/db/middleware-dev.db
export TEST_MERCHANT_ID=merchant_c3d547a10f43eeec
export TEST_CLINIC_ID=clinic-default
export COMMERCE_TEST_API_BASE=http://localhost:4010
export INTERNAL_JOB_TOKEN=dev-e2e
```

---

## Execution modes by channel

### 1. `chat` — Kelly commerce lane

```
For each turn in scenario.transcript where role=user:
  KellyAgentService.processTurn({
    sessionId,
    message: turn.text,
    channel: 'chat',
    commerceCheckout: { productId, providerId: clinic_id }
  })
Assert agent.expect on result.reply
Assert tool_expectations via result.toolsUsed + kelly_call_events
Assert state_assertions via DB reads
```

**Entry code:** [`kelly-agent-service.js`](../../middleware-platform/services/kelly-agent-service.js) `_processCommerceCheckoutTurn`

### 2. `voice` — Kelly turn or WS mock

**Option A (preferred):** `runKellyTurn()` with voice channel context when commerce tools invoked via Retell function_call mock:

```
For each user turn:
  mock RetellWebSocketHandler.handleFunctionCall OR
  runKellyTurn({ sessionId: callId, transcript, channel: 'voice', merchant_id })
```

**Option B:** Full WS integration test with recorded `function_call` / `response_required` frames.

**Voice commerce tools:** `search_products`, `create_checkout` ([`retell-functions.json`](../../middleware-platform/retell-functions/retell-functions.json))  
**Handlers:** [`retell-websocket.js`](../../middleware-platform/webhooks/retell-websocket.js)

### 3. `both` — Sequential dual-channel

Run voice path then chat path (or parallel with distinct session IDs).  
**Parity scenarios (C-006):** compare `amount_cents` from quote API vs voice checkout.

### 4. `chat_ui` — Playwright

```
Base URL: https://callsomo.com/patients/checkout-chat.html?product_id=sku_vitd3_2000
Or local static server + API proxy

For ui_assertions:
  - DOM selectors (#productTitle, #btnPayInThread, #headerCartCount)
  - API intercepts (/api/public/commerce/quote, /turn/stream)
  - sessionStorage cc_journey_state keys
  - analytics event spy (agentic_primary, in_chat_pay_tap)
```

**UI files:** [`checkout-chat.html`](../../unified-dashboard/patients/checkout-chat.html), [`checkout-chat.js`](../../unified-dashboard/patients/checkout-chat.js)

---

## Assertion evaluation

Load assertion definitions from [`commerce-assertion-schema.json`](../../middleware-platform/tests/fixtures/commerce-assertion-schema.json).

| assertion id | Evaluator (proposed) |
|--------------|----------------------|
| ACK_BEFORE_TRANSACTION | Regex `empathetic_prefix` on agent reply before first tool |
| VENT_HANDOFF | DB: `handoff_subrail` step OR `handoff_exhausted` event |
| CHECKOUT_STAGE_FSM | Read `meta_kv.checkout_stage`; validate against `checkout_stage_fsm` |
| TOOL_COMPLETED_BEFORE_CLAIM | `kelly_call_events` ordering |
| VOICE_COMMERCE_TOOL_CHAIN | `tool_completed` sequence + HTTP 200 on `/voice/checkout/create` |
| CHAT_COMMERCE_TOOL_CHAIN | tools + Stripe PI present |
| WER_THRESHOLD | Run `speech-asr-eval.cjs` logic on paired utterance |
| FRONTEND_* | Playwright expectations |

On failure, emit row per [`COMMERCE_100_SCENARIO_REPORT_TEMPLATE.md`](../qa/COMMERCE_100_SCENARIO_REPORT_TEMPLATE.md) with `code_primary` from assertion schema.

---

## DB queries (post-turn)

Reuse patterns from [`verify-live-shared.cjs`](../../middleware-platform/scripts/verify-live-shared.cjs):

```sql
-- kelly_call_events
SELECT event_type, payload_json FROM kelly_call_events WHERE session_id = ? ORDER BY id;

-- checkout stage
SELECT meta_value FROM kelly_session_meta_kv WHERE session_id = ? AND meta_key = 'checkout_stage';

-- rails projection
SELECT active_lane, step, flags_json FROM kelly_rails_session_projection WHERE session_id = ?;

-- commerce cart
SELECT * FROM commerce_carts WHERE session_id = ?;
```

---

## Speech metrics collection

| Metric | Source |
|--------|--------|
| WER/CER/SER | [`commerce-speech-golden-set.json`](../../middleware-platform/eval/commerce-speech-golden-set.json) + Levenshtein ([`speech-asr-eval.cjs`](../../middleware-platform/scripts/speech-asr-eval.cjs)) |
| EOT latency, RTF, confidence | In-process metrics from [`voice-speech-metrics.js`](../../middleware-platform/services/voice-speech-metrics.js) when WS path used |
| Voice SLO | `GET /api/public/landing-assistant/voice-metrics/:sessionId` |

Scenario C-089 runs batch eval on all 30 ASR pairs.

---

## Skip handling

| Scenario | skip_reason |
|----------|-------------|
| C-073 | Appointment pay voice-primary — mark SKIP, exclude from AQS denominator or weight redistributed |

---

## Output

1. **Console:** per-scenario ✅/❌ with assertion detail  
2. **JSON:** `tmp/commerce-run-{runId}.json` — full results  
3. **Markdown:** filled report template with AQS  
4. **Exit code:** `0` if all P0 pass; `1` otherwise

---

## CI integration (future)

```yaml
# Proposed job — not wired yet
- run: npm run test:commerce-100-scenarios -- --filter C-001,C-003,C-030,C-038 --channel chat
```

Start with chat P0 subset before full 100 + voice + Playwright.

---

## Related existing scripts

| Script | Overlap |
|--------|---------|
| `test-commerce-checkout-agent.js` | C-001, C-003, C-015, C-017, C-030 |
| `rails-conversation-sandbox.cjs` | C-049–C-066 booking/cancel patterns |
| `speech-asr-eval.cjs` | C-089 |
| `verify-agentic-checkout.cjs` | C-099 static only |

---

## Out of scope for runner v1

- Live Retell PSTN calls
- Production merchant catalog
- Fixing predicted failures F-01–F-10 (document only)
