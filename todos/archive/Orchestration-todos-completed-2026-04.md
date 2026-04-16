# Orchestration — completed work (archived April 2026)

Extracted from `pending/Orchestration-todos.md` when the live file was trimmed to **pending items only**.  
Current architecture intro and **open** tasks: [`../pending/Orchestration-todos.md`](../pending/Orchestration-todos.md).

---

## Todo backlog (completed)

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

### Completed: Canonical tool event pipeline (single source of truth)

All former `[x]` items under: schema/contracts, emitter/performance, persistence/lifecycle, instrumentation coverage, distributed-system correctness, trace correlation, metrics refactor, rollout, testing/ops — **completed** in codebase; see `emitToolEvent`, `tool_call_events`, `TOOL_EVENT_PIPELINE_ENABLED`, and related tests in `middleware-platform/`.

### Suggested execution order (completed)

1. Schema + emitter contract.
2. Non-blocking queue + log sink.
3. DB table + write helpers + migration.
4. Instrument Kelly loop + checkout graph nodes.
5. `toolsUsed` refactor to canonical events.
6. Zombie-attempt reconciler + dashboards + alerts.

### Review backlog — completed sections

- Architecture & onboarding (`docs/middleware-platform/ARCHITECTURE.md`, `CONTRIBUTING.md`).
- Patient checkout UI splits, Playwright post-pay lock, phone E164 alignment.
- Backend/data backfill and `getCustomerByPhone` multi-candidate.
- Tests & CI (security gate, Playwright install docs).
- Remove dead CSS `.cc-btn-exit-checkout`.
