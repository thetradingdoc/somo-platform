# Orchestration todos

## Hybrid orchestration (current architecture)

The current system uses a hybrid orchestration model:

- LangGraph is used where deterministic, checkpointable state transitions are needed (for example, voice coding state and video consult pipelines).
- Kelly uses an LLM tool-calling loop for conversational flexibility, where the model can select tools and iterate until it reaches an answer.
- LLM routing and fallback are centralized in `middleware-platform/services/llm-router.js` (Anthropic/Groq primary and fallback handling).
- This design is built around a practical split of responsibilities:
  - graph-managed control flow for strict process stages,
  - agent-managed conversational reasoning inside bounded contexts.

Why this matters for checkout:

- Checkout is payment-critical and should behave like a transaction system, not an open-ended conversation.
- The current Kelly loop already has orchestration, but it is policy/loop orchestration (soft control), not full state-machine orchestration (hard control).
- The target evolution is: LangGraph as host controller, Kelly as a bounded sub-node for conversational UX within strict graph guardrails.

## Todo backlog with status

### Completed: Checkout graph foundation and Batch 3 hardening

- [x] Define `CheckoutStateGraph` state shape, terminal states, and transition contracts.
- [x] Implement host graph skeleton (`entry -> gather_context` with explicit terminal outcomes).
- [x] Add bounded `KellyCommerceAgent` sub-node interface.
- [x] Restrict checkout node to commerce-focused toolset.
- [x] Add deterministic payment-critical nodes (`checkout_init`, `code_verify`, `payment_confirm`, `receipt_emit`).
- [x] Add explicit retry/error routing and terminal recovery paths.
- [x] Implement handoff back to general Kelly flow after terminal checkout outcomes.
- [x] Add ambiguity pre-router for mixed clinical + commerce prompts.
- [x] Add session concurrency protection for checkout turns.
- [x] Add PII/PCI redaction layer for graph/tool telemetry.
- [x] Add turn-limit stuck detector with human handoff fallback.
- [x] Integrate checkpointer strategy (Postgres where configured, Memory fallback).
- [x] Add structured telemetry events for graph turns.
- [x] Add initial checkout graph tests for helper behavior and redaction.
- [x] Add interruption intent handling (`code_verify -> gather_context`) for side-quests.
- [x] Add live cart revalidation in `gather_context` with cart fingerprint and invalidation routing.
- [x] Add 2s circuit-breaker wrapper in `server.js` with payment-safe degraded UX.
- [x] Add short TTL verify idempotency cache in `code_verify`.
- [x] Extend checkout prompt with secure-transaction focus/defer non-commerce rule.

### Files updated for completed work

- `middleware-platform/services/checkout-graph.js`
- `middleware-platform/services/checkout-graph-schema.js`
- `middleware-platform/services/redaction-service.js`
- `middleware-platform/services/telemetry-service.js`
- `middleware-platform/services/kelly-agent-service.js`
- `middleware-platform/server.js`
- `middleware-platform/__tests__/checkout-graph.test.js`

## Pending: Canonical tool event pipeline (single source of truth)

### Schema and contracts

- [x] Define canonical `tool_call_event` schema with:
  - `event_id`, `ts`, `session_id`, `thread_id`, `run_id`, `parent_run_id`, `transition_id`
  - `node`, `tool_name`, `status`, `attempt`, `path`, `orchestrator_type`
  - `latency_ms`, `channel`, `provider`
  - `error_code`, `cached`, `idempotency_key`
  - optional `token_count`, `estimated_cost`
- [x] Enforce enum contracts:
  - `status`: `attempt|success|error|blocked|retry|cached|system_timeout`
  - `path`: `legacy_loop|langgraph_node`
- [x] Finalize redaction rules for event payloads.

### Emitter and performance

- [x] Implement non-blocking `emitToolEvent(event)` (fire-and-forget).
- [x] Add bounded async queue with drop policy + metrics.
- [x] Add retry/backoff for sink failures.
- [x] Add fallback structured-log sink.
- [x] Add emitter health metrics (queue depth, flush latency, drops, write errors).

### Persistence and lifecycle

- [x] Create `tool_call_events` table and indexes (`ts`, `session_id`, `tool_name`, `status`, `path`, `run_id`, `parent_run_id`).
- [x] Add DB helpers for single and batched writes.
- [x] Add retention/TTL cleanup job.
- [x] Add migration and rollback path.

### Instrumentation coverage

- [x] Instrument `KellyAgentService._runLLMLoop` for `attempt/success/error/blocked/retry`.
- [x] Instrument deterministic graph nodes (`checkout_init`, `code_verify`) to emit canonical events.
- [x] Emit `cached` event when verify idempotency cache is used.
- [x] Always set `path` and `orchestrator_type`.
- [x] Propagate `parent_run_id` for graph -> Kelly sub-node tool calls.
- [x] Emit explicit invalid-tool events (`error_code=TOOL_NOT_FOUND`) when LLM requests missing tools.

### Distributed-system correctness

- [x] Add zombie-attempt detector: mark unresolved `attempt` as `system_timeout` after 60s in derived views.
- [x] Add reconciler job/view to close dangling attempts.

### Trace correlation

- [x] Mirror canonical event IDs in LangSmith metadata.
- [x] Correlate by `thread_id/run_id/parent_run_id/transition_id`.

### Metrics refactor

- [x] Refactor `toolsUsed` to derive from canonical events (or in-memory mirror of canonical stream).
- [x] Keep short compatibility adapter, then remove old ad-hoc counters.

### Rollout

- [x] Add `TOOL_EVENT_PIPELINE_ENABLED` feature flag.
- [x] Shadow mode first (emit only), then staged rollout (10% -> 50% -> 100%).
- [x] Add rollback switch (disable DB sink without affecting request flow).

### Testing and ops

- [x] Unit tests for schema validation + redaction.
- [x] Unit tests for non-blocking behavior under slow/failing sink.
- [x] Integration tests for status lifecycle (`attempt/success/error/blocked/retry/cached/system_timeout`).
- [x] Integration test for `parent_run_id` grouping.
- [x] Integration test for `TOOL_NOT_FOUND` event emission.
- [x] Regression test for response latency under telemetry sink failure.
- [x] Build dashboards and alerts for path divergence, timeout spikes, tool-not-found spikes, and emitter health.

## Suggested execution order (completed)

1. Schema + emitter contract.
2. Non-blocking queue + log sink.
3. DB table + write helpers + migration.
4. Instrument Kelly loop + checkout graph nodes.
5. `toolsUsed` refactor to canonical events.
6. Zombie-attempt reconciler + dashboards + alerts.

## Review backlog (from orchestration / checkout hardening)

### Architecture & onboarding

- [x] **`docs/ARCHITECTURE.md`** — repo layout, static hosting, checkout path, Kelly ↔ cart session, links to runbooks (`middleware-platform/docs/ARCHITECTURE.md`).
- [x] **`CONTRIBUTING.md`** — env basics, `npm test` vs Playwright, `CHECKOUT_E2E_BASE_URL` / `window.API_BASE`, Playwright install note.

### Patient checkout UI

- [x] Split `checkout-chat.html`: `checkout-chat.css`, `checkout-chat.js`, `checkout-phone-e164.js`.
- [x] Playwright regression: post-payment lock hook — `middleware-platform/e2e/checkout-post-payment-lock.spec.cjs` (`cc_test_hooks=1`); run `npm run test:e2e-checkout-postpay-lock` with API up.
- [x] Phone normalization aligned with server via shared logic copy + Jest vectors (`phone-e164.test.js` comment).

### Backend / data

- [x] Optional backfill: `npm run backfill:phone-e164` (`DRY_RUN=1` supported) — `scripts/backfill-customer-phone-e164.cjs`.
- [x] `getCustomerByPhone` / Twilio lookup: multi-candidate (`database.js` `phoneLookupCandidates`).

### Tests & CI

- [x] CI runs `npm test` + `release:security-gate` on PRs (`.github/workflows/ci.yml`); full Playwright documented as optional in `CONTRIBUTING.md`.
- [x] Playwright Chromium install documented (`npx playwright install chromium`).

### Product / UX / security (ongoing)

- [ ] End-to-end replay of reported user transcripts (QA).
- [ ] Landing ↔ checkout parity: keep `e2e/landing-cta-entry-flows.spec.cjs` in sync with `littlelab-landing` query params.
- [ ] Periodically re-read `PREDEPLOY_SECURITY_CHECKLIST.md` + `PAYMENT_DATA_INCIDENT_PLAYBOOK.md`; extend redaction for new checkout fields.

### Technical debt

- [ ] Long-term `server.js` route split — follow `SERVER_JS_REFACTOR_POLICY.md` if the team scopes it.
- [x] Remove dead CSS `.cc-btn-exit-checkout` from checkout styles.
