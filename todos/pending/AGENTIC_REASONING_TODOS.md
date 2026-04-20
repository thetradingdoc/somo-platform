# Agentic Reasoning Todos

Date: 2026-04-17  
Owner: Platform + Landing Assistant  
Status: Active

**Docs:** Canonical reasoning architecture and contracts: [`docs/reasoning/README.md`](../../docs/reasoning/README.md). Supplemental / diagrams: [`docs/middleware-platform/README.md#agentic-reasoning-solution-design`](../../docs/middleware-platform/README.md#agentic-reasoning-solution-design). All other middleware docs: [`docs/middleware-platform/README.md`](../../docs/middleware-platform/README.md) (single consolidated file).

## Launch Gates

### Immediate safety stop (today)

- [✓] Confirm `RESULT_SUMMARY_REASONING_V1` value in production now.
  - [✓] If ON: either disable immediately or apply stub-honesty patch before end of day.
  - [✓] Document owner + rollback procedure in deployment runbook.

- [✓] Add and enforce `reasoning_mode` now (`'stub' | 'model' | 'deterministic_fallback'`).
  - [✓] Stub path must always emit `reasoning_mode: 'stub'`.
  - [✓] Any non-model fallback path emits `reasoning_mode: 'deterministic_fallback'`.
  - [✓] UI must show AI-facing reasoning panel/copy only when `reasoning_mode === 'model'`.

- [✓] Stub provenance honesty cleanup in `result-summary-reasoning-service.js`.
  - [✓] Remove fabricated `reasoning_evidence_refs` and fake source labels from stub output.
  - [✓] Remove fabricated `doc_id_ref` / claim provenance entries from stub path.
  - [✓] Keep empty refs or route-context-only refs in stub mode.
  - [✓] Replace `reasoning_model` with explicit deterministic stub identifier.

- [✓] Remove hardcoded alternatives from stub path immediately.
  - [✓] Delete hardcoded product names (for example niacinamide alternatives).
  - [✓] Suppress alternatives candidates entirely in stub mode.

- [✓] Resolve outstanding frontend truthfulness/route bugs in `AssistantResultsPage.jsx`.
  - [✓] Remove all `fallback={getReasoningUnavailableCopy(...)}` VerdictRow call sites.
  - [✓] Gate `classifyIngredients(...)` on cosmetic context only.
  - [✓] Remove duplicate alternatives CTA/footer path.
  - [✓] Gate `fallbackChildrenAnswer` acid/retinoid heuristic on cosmetic context only.
  - [✓] Remove user-visible model/version leakage from reasoning panel summary.

- [✓] Ensure ingredient sanitization reaches LLM context in `useAssistantSession.js`.
  - [✓] Apply `sanitizeIngredientText` to thread-event ingredient payload in both barcode paths.
  - [✓] Confirm no HTML/allergen span artifacts are sent in `publishLandingThreadEvent` text.

### Must before canary

- [✓] Investigate and drain tool-call DLQ backlog (currently above threshold).
  - [✓] Classify failure types (validation, timeout, dependency, auth, schema drift).
  - [✓] Identify retry-safe vs terminal failures.
  - [✓] Replay retry-safe entries and verify success rate.
  - [✓] Add incident note with root cause + prevention.

- [✓] Fix `POST /api/public/landing-assistant/voice-metrics/inc` 400 responses.
  - [✓] Reproduce from scan flow.
  - [✓] Validate request body contract and required fields.
  - [✓] Patch caller/server validation mismatch.
  - [✓] Add regression test for accepted payload shape.

- [✓] Ensure alternatives CTA/list works for deterministic paths.
  - [✓] Remove source-overstrict gating that suppresses deterministic alternatives.
  - [✓] Keep confidence and eligibility checks route-safe.
  - [✓] Add UI test coverage for deterministic alternatives visibility.

- [✓] Add prompt/data safety guardrails for reasoning input.
  - [✓] Sanitize model-bound fields (strip markup/URLs where needed).
  - [✓] Enforce token-budget truncation policy before model call.
  - [✓] Apply PII redaction policy for reasoning prompts/logs.

- [✓] Add output safety/compliance gate for model text.
  - [✓] Block unsafe medical claims (diagnosis/cure guarantees).
  - [✓] Enforce informational-only constraints on model-generated copy.

- [✓] Add provider reliability controls.
  - [✓] Circuit breaker for model provider failures.
  - [✓] Bounded retry with backoff + jitter for 429/5xx.
  - [✓] Independent emergency kill switch (separate from feature flag).

### Must before 100%

- [✓] Safety score UX decision.
  - [✓] Hide tile until pipeline exists OR (N/A: explicit "coming soon" path selected)
  - [✓] Show explicit "coming soon" state without misleading pending/progress framing.
  - [✓] Update copy and tests accordingly.

- [✓] Canary and rollback runbook for `REACT_APP_RESULTS_SUMMARY_V1`.
  - [✓] Define rollout steps by environment.
  - [✓] Define rollback trigger and owner.
  - [✓] Document in deployment runbook.

- [✓] Regression telemetry + alerts for route safety.
  - [✓] Alert on non-cosmetic scans emitting cosmetic harmful copy.
  - [✓] Alert on non-cosmetic scans exposing `key_actives` as available.
  - [✓] Alert on non-cosmetic snapshots containing NYC metal context.

- [✓] Add model cost + latency observability.
  - [✓] Track tokens and per-call estimated cost.
  - [✓] Track p50/p95 reasoning latency.
  - [✓] Alert on latency/cost/fallback spikes.

- [✓] Add concurrency/idempotency guarantees.
  - [✓] Prevent duplicate apply for same `(session_id, snapshot_id, input_hash)`.
  - [✓] Add race-condition tests for stale snapshot and double enqueue cases.

- [✓] Build eval harness and quality baseline.
  - [✓] Create offline eval set + scoring rubric (route safety, harm precision, child safety).
  - [✓] Benchmark deterministic baseline vs model-backed path.

- [✓] Schema/version governance.
  - [✓] Define reasoning payload versioning policy.
  - [✓] Add backward compatibility tests for frontend payload consumption.

## Reasoning Completeness (Core Implementation)

- [✓] Complete reasoning augmentation pipeline (Phase 4.2).
  - [✓] Route-aware augmentation contract enforcement.
  - [✓] Confidence-gate parity across verdict fields.
  - [✓] Provenance/evidence integrity checks.

- [✓] Replace stub logic with real model-backed patch generation.
  - [✓] Structured model call with strict JSON output contract.
  - [✓] Fail closed to deterministic fallback on parse/validation/API errors.
  - [✓] Truthful `reasoning_mode` propagation across outputs.

- [✓] Pinecone readiness and provenance honesty.
  - [✓] Verify ingredient semantic index exists and is populated.
  - [✓] Disable/guard claims of semantic retrieval when index is unavailable.
  - [✓] Emit provenance only for sources that were truly executed.

- [✓] Alternatives quality rollout.
  - [✓] Enable reasoning-backed alternatives once confidence gates and evidence pass.
  - [✓] Add route-specific acceptance tests for alternatives behavior.

## Post-launch Enhancements

- [✓] Localization parity for reasoning copy.
  - [✓] Ensure reasoning text respects session language.
  - [✓] Add regression tests for non-English paths.

- [✓] Advanced retrieval/graph upgrades.
  - [✓] Pinecone-backed grounding expansion.
  - [✓] Deeper graph traversal and higher-order thought strategies (GoT/ToT) after stable model baseline.

## Validation Gate (Release Checklist)

- [✓] Reproduce Welch sample barcode end-to-end in production-like environment.
- [✓] Confirm food route output checklist:
  - [✓] No cosmetic chips/watch framing.
  - [✓] No retinoid/exfoliant warning for food acids.
  - [✓] Child safety reflects dye caution where present.
  - [✓] Ingredient text is clean (no HTML artifacts) in UI and thread payload.
  - [✓] NYC panel/context hidden for food route.
  - [✓] No noisy internal reasoning fallback strings.
  - [✓] Single alternatives CTA path.
  - [✓] Route-appropriate heading and upsell copy.
- [✓] Frontend regression suite passes.
- [✓] Backend regression suite passes.
- [✓] DLQ below threshold and stable post-fix.

## Execution order

- [✓] Today: flag check -> stub provenance cleanup -> JSX bug fixes -> sanitize thread payload.
- [✓] This week: `voice-metrics/inc` 400 fix -> DLQ drain -> real model call + schema validation.
- [✓] Before canary: eval harness -> cost/latency observability -> provider circuit breaker.
- [✓] Before 100%: canary runbook rehearsal -> regression alerts verification -> schema governance.

## Architecture Target Implementation Backlog (Unified Pipeline v2)

This section tracks implementation of the proposed architecture in `docs/reasoning/README.md` (Architecture overview):

`User action -> Unified Context Ingest -> Route+Intent Planner -> Policy Pack -> Deterministic Baseline -> Snapshot pending -> Reasoning Job -> Retrieval -> Model JSON -> Gate Stack -> Reasoning FSM -> Atomic Merge -> Results UI + Chat Context`

### A) Unified Context Ingest (single writer)

- [✓] Implement single context writer service used by both `/turn` and `/thread-event`.
- [✓] Add idempotency key for context writes (`session_id + event_id`).
- [✓] Add monotonic `context_version` per session.
- [✓] Persist source metadata on each context event (`camera_scan`, `chat_turn`, `manual_edit`).
- [✓] Reject stale/out-of-order context updates by version check.
- [✓] Add context-write metrics (`success`, `duplicate`, `stale_reject`).
- [✓] Add tests for duplicate and reordered events.

### B) Route + Intent Planner (first gate)

- [✓] Run route+intent planner before Kelly prompt/tool selection on every turn.
- [✓] Persist planner decision (`route`, `intent`, `policy_pack`) in turn metadata.
- [✓] Add hard guard: food/supplement route blocks skincare clarifier branch.
- [✓] Add mixed-intent arbitration strategy (scan question + triage question).
- [✓] Add planner metrics (`planner.route.*`, `planner.intent.*`, `planner.policy_pack.*`).
- [✓] Add regression tests for known scan-chat failures.

### C) Deterministic baseline + snapshot pending

- [✓] Always build deterministic baseline first for every reasoning-eligible snapshot.
- [✓] Persist `snapshot_version = N` with `reasoning_state = pending`.
- [✓] Persist `context_hash` / `baseline_hash` on snapshot.
- [✓] Ensure route-safe deterministic copy templates across all routes.
- [✓] Add tests for deterministic snapshot stability under repeated turns.

### D) Reasoning job enqueue + execution

- [✓] Enqueue reasoning job with key: `session_id + snapshot_version + context_hash`.
- [✓] Deduplicate jobs for identical key.
- [✓] Add bounded retry policy with jitter for transient failures.
- [✓] Add terminal-failure handoff to DLQ path.
- [✓] Add worker lifecycle metrics (`enqueued`, `started`, `success`, `retry`, `dlq`).
- [✓] Add ops scripts for replay/cancel/inspect reasoning jobs.

### E) Retrieval grounding

- [✓] Standardize retrieval context contract for reasoning jobs.
- [✓] Integrate hazard dictionary as required retrieval source.
- [✓] Integrate vector source behind readiness flag.
- [✓] Persist truthful `executed_sources` for each reasoning attempt.
- [✓] Add retrieval metrics (`source_used`, `source_fail`, latency).
- [✓] Add tests for no-source/partial-source behavior.

### F) Model reasoning JSON contract

- [✓] Enforce strict JSON-only response parsing.
- [✓] Maintain route-scoped prompt templates.
- [✓] Enforce provider timeout and circuit breaker in model stage.
- [✓] On parse/validation/provider errors, fail closed to deterministic fallback.
- [✓] Persist model call telemetry (latency, token/cost estimate, error class).

### G) Gate stack + per-gate observability

- [✓] Implement explicit gates in order: schema -> semantic -> confidence -> safety.
- [✓] Emit per-gate counters:
  - [✓] `reasoning.gate.schema.fail.count`
  - [✓] `reasoning.gate.semantic_contract.fail.count`
  - [✓] `reasoning.gate.confidence.defer.count`
  - [✓] `reasoning.gate.safety.fail.count`
  - [✓] `reasoning.gate.provider_error.count`
- [✓] Persist gate decision payload for incident triage.
- [✓] Add tests for each gate’s reject/defer behavior.

### H) Reasoning-ready FSM

- [✓] Implement state transitions:
  - [✓] `pending -> complete`
  - [✓] `pending -> fallback`
- [✓] Persist `fallback_reason` enum when entering fallback.
- [✓] Prevent invalid transitions (for example complete -> pending).
- [✓] Add transition latency metrics.
- [✓] Add tests for transition correctness.

### I) Atomic merge (snapshot vN+1)

- [✓] Merge reasoning patch only if snapshot lineage matches (`snapshot_version + context_hash`).
- [✓] Reject stale job merges and mark as obsolete.
- [✓] Commit merged output atomically as `snapshot_version = N+1`.
- [✓] Persist `reasoning_mode`, `reasoning_state`, `reasoning_version`, `reasoning_input_hash`.
- [✓] Add merge metrics (`merge_success`, `stale_reject`, `conflict_reject`).
- [✓] Add concurrency race tests (parallel jobs, delayed jobs).

### J) Render policy and chat follow-up

- [✓] Enforce UI rule: show AI panel only when `reasoning_mode=model` and `reasoning_state=complete`.
- [✓] Define explicit UI behavior for `pending` and `fallback` states.
- [✓] Ensure chat follow-up context prefers latest merged snapshot (if complete) else deterministic baseline.
- [✓] Add frontend tests for all mode/state combinations.
- [✓] Add E2E assertions for pending->complete transition rendering.

### K) Operations, alerts, and rollback/re-enable

- [✓] Update `ALERT_RULES.md` mappings so reasoning alerts link to reasoning-specific runbooks only.
- [✓] Add runbook for gate-level failure triage.
- [✓] Add runbook for kill-switch recovery (`disable -> stabilize -> re-enable`).
- [✓] Add one-command readiness check before re-enable.
- [✓] Add post-incident template requiring gate-level root-cause summary.

### L) Rollout gating for unified pipeline

- [✓] Add shadow-mode rollout step (compute reasoning, no UI promotion).
- [✓] Define canary acceptance thresholds for each gate failure metric.
- [✓] Require `test:reasoning-regression`, eval harness, and full scan-chat E2E gates before ramp.
- [✓] Run staged rollout: 5% -> 20% -> 50% -> 100% with hold windows.
- [✓] Document rollback decision matrix keyed by gate-specific failures.

## Missing from Full Pipeline Checklist (Added 2026-04-19)

These items close gaps between the architecture proposal and the initial Unified Pipeline v2 backlog.

### M) Foundation and contract guardrails

- [✓] Define canonical entities in one contract doc: `session_context`, `snapshot`, `reasoning_job`, `reasoning_patch`.
- [✓] Freeze canonical `reasoning_state` enum (`pending | complete | fallback`) in shared schema docs.
- [✓] Freeze canonical `reasoning_mode` enum (`model | deterministic_fallback | stub`) and explicitly decide whether `stub` remains supported.
- [✓] Add ADR documenting required architecture: single-writer context + async reasoning + atomic merge.
- [✓] Add backward-compatibility policy for legacy snapshots that do not include `reasoning_state`.

### N) Context and planner specificity

- [✓] Explicitly migrate `barcode_product_context` from side-channel semantics to unified context writer semantics.
- [✓] Define and persist normalized planner outputs:
  - [✓] `route_context` (route, source, confidence, fallback flags)
  - [✓] `intent_context` (scan/routine/triage/mixed classification)
- [✓] Implement explicit policy-pack resolver (`food`, `supplement`, `cosmetic`, `unknown`) with documented fallback behavior.

### O) Worker and retrieval hardening

- [✓] Add explicit queue/table schema task for reasoning jobs and state lifecycle.
- [✓] Add worker heartbeat and timeout watchdog handling tasks.
- [✓] Add explicit retrieval graceful-degradation policy tasks (no-source, partial-source, stale-source behavior).
- [✓] Persist retrieval provenance object per job execution for debugging and audits.
- [✓] Add explicit prompt sanitization task: model payload must include only sanitized/allowlisted context fields.

### P) FSM and merge auditing details

- [✓] Add transition audit trail with timestamps and actor/reason metadata for `reasoning_state`.
- [✓] Add explicit stale transition guard so older transitions cannot overwrite newer snapshot states.
- [✓] Add explicit stale-merge alert threshold and alert rule wiring.

### Q) UI/UX behavior details for pending/fallback

- [✓] Add stable pending->complete UI transition behavior (no jarring reflow/content jump).
- [✓] Add explicit pending indicator copy to make eventual consistency intentional to users.
- [✓] Add explicit fallback indicator copy when `reasoning_state=fallback`.
- [✓] Add explicit route-aware render pruning task for unsupported tile families in non-cosmetic routes.
- [✓] Prevent older pending/fallback context from overriding newer complete context in follow-up chat.

### R) Observability dashboards and runbook precision

- [✓] Create dashboard panels per gate and FSM transition (not only aggregate fallback totals).
- [✓] Add alert for stale merge rejects above threshold.
- [✓] Add required re-enable checks to kill-switch recovery runbook:
  - [✓] gate failure rates below threshold
  - [✓] DLQ stable
  - [✓] route regression counters are zero
  - [✓] regression + E2E suites green

### S) Explicit test-plan and rollout completeness

- [✓] Add dedicated test-plan section covering:
  - [✓] unit tests (planner, gate logic, FSM, atomic merge)
  - [✓] integration tests (ingest -> pending -> job -> complete/fallback merge)
  - [✓] load/concurrency tests (queue and merge races)
- [✓] Add explicit rollout guard task: deploy behind flags only.
- [✓] Add explicit stage sequencing task text for rollout (`shadow -> 5% -> 20% -> 50% -> 100%`).
- [✓] Add explicit rollback trigger task tied to gate-level and route-regression metrics.

