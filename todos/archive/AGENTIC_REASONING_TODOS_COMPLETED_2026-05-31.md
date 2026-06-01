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

## Production Readiness Rebaseline (2026-04-20)

Source of truth checklist to close the remaining live-system signoff gap.

### Batch 1 (in progress): gate script correctness + harness contract alignment

- [ ] **Gate Script Correctness**
- [x] **Gate Script Correctness**
  - [x] Make Pinecone checks fully synchronous/awaited before summary and exit code.
  - [x] Remove/replace `test:reasoning-regression` with existing checks.
  - [x] Align harness invocation with actual CLI (`--output` supported by harness).
  - [x] **Done when:** gate script produces deterministic pass/fail without race conditions or missing-script failures.

- [x] **Harness Output Contract Alignment**
  - [x] Standardize a canonical artifact schema (`cases[].reasoning_mode`, `rubric_summary`, `gate_coverage`).
  - [x] Ensure gate reads emitted fields directly.
  - [x] **Done when:** no parser fallbacks/warnings; all required checks are driven from real artifact fields.

- [x] **Live Model Path Enforcement (No Stub Fallback)**
  - [x] In live mode, harness fails when any case reports non-`model`.
  - [x] Verify true provider path in environment (no provider fallback to stub). (`REASONING_HARNESS_LIVE_MODEL=1`, `RESULT_SUMMARY_REASONING_MODEL_TIMEOUT_MS=25000`, harness output shows `reasoning_mode=model` for all cases; `reasoning.gate.provider_error.count=0`).
  - [x] **Done when:** all live runs show provider-backed `reasoning_mode=model`.

### Batch 2: Pinecone + retrieval truthfulness

- [ ] **Pinecone Real-Readiness Proof**
  - [x] Run readiness in env with Pinecone configured/populated. (Gate now runs `verify:reasoning:pinecone-readiness` + direct index stats probe.)
  - [x] Enforce minimum vector count and minimum retrieval-hit case count. (Gate checks `PINECONE_MIN_VECTOR_COUNT` and `PINECONE_MIN_RETRIEVAL_CASES`.)
  - [x] Enforce provenance honesty (`status=none` must not claim Pinecone-backed provenance). (`RETRIEVAL_PROVENANCE_HONEST` check added.)
  - [x] Option A mode wired: `REASONING_OPTION_A_NO_VECTOR=1` now downgrades Pinecone/index/retrieval checks to warnings while still enforcing provenance honesty.
  - [ ] **Current blocker (for future Pinecone-on rollout):** set `PINECONE_INDEX_HOST`/`PINECONE_INDEX_URL` + index population, then run with `REASONING_OPTION_A_NO_VECTOR=0`.
  - **Done when:** either Option A (no-vector + honest provenance) is explicitly approved for this release, or Pinecone checks pass above threshold in Option B.

### Batch 3: docs/runbook wiring + release artifacts

- [x] **Runbook/Docs Path Update for Consolidated Docs**
  - [x] Update checks to consolidated anchors under `docs/runbooks/README.md` and `docs/reasoning/README.md`. (Gate now validates these files + required reasoning anchors.)
  - [x] Remove assumptions about deleted per-file runbooks. (Checks now target consolidated docs only.)
  - [x] **Done when:** gate validates current docs structure only.

- [x] **Alert-to-Runbook Wiring Validation**
  - [x] Verify each reasoning alert maps to reasoning-specific runbooks. (Gate now validates reasoning alert rows map to reasoning runbook anchors, not generic files.)
  - [x] Validate real alert objects/IDs in Azure (not docs-only). (Gate now requires `reasoning-alert-inventory.json` with alert IDs + runbook links and validates reasoning alert coverage.)
  - [x] **Done when:** alert map + live wiring evidence both present.

- [x] **Canary + Rollback Drill Evidence**
  - [x] Execute staged canary ramp and kill-switch rollback drill.
  - [x] Record operator, timestamps, stages, and recovery verification in artifact JSON. (`canary-drill-evidence.json` now hard-required by gate with schema checks.)
  - [x] **Done when:** `canary-drill-evidence.json` exists and passes schema/truth checks.

- [x] **Dashboard Signoff Evidence**
  - [x] Validate required monitoring panels and fire synthetic alert(s).
  - [x] Capture dashboard URL, panel set, alert IDs, and operator signoff. (`dashboard-signoff.json` now hard-required by gate with schema checks.)
  - [x] **Done when:** `dashboard-signoff.json` exists and proves live observability wiring.

### Batch 4: stability/risk gates before ramp

- [x] **DLQ Stability Gate**
  - [x] Verify tool-call DLQ backlog is at/under threshold before ramp. (Gate now runs `ops:dlq:tool-calls:triage-replay` + threshold assertion.)
  - [x] Record parsed count and terminal-resolution status. (Gate now runs `ops:dlq:tool-calls:resolve-terminal` and writes `dlq-stability-evidence.json`.)
  - [x] **Done when:** DLQ gate passes with measurable backlog evidence.

- [x] **Route Regression Counter Gate**
  - [x] Pull required regression counters and assert zero (or approved threshold) pre-ramp. (Gate now validates `metrics` against `REASONING_ROUTE_REGRESSION_MAX_COUNT`.)
  - [x] Store snapshot artifact with timestamp and metric values. (`route-regression-snapshot.json` created and validated by gate.)
  - [x] **Done when:** route regression artifact exists and counters are within policy.

- [x] **Appointment Slot Migration Risk Decision**
  - [x] Record explicit risk memo with owner + decision (`safe_to_ship` or `requires_fix_before_ship`). (Gate now enforces decision enum + blocks on `requires_fix_before_ship`.)
  - [x] Include dedupe audit evidence and queue/snapshot interaction assessment. (`migration-risk-memo.json` created and validated by gate.)
  - [x] **Done when:** signed `migration-risk-memo.json` exists and decision is explicit.

- [x] **E2E Scan-Chat Two-Turn Gate**
  - [x] Run full two-turn E2E gate and require green before ramp. (Gate now executes `test:e2e-chat-scan-gate` unless skip is explicitly set.)
  - [x] If skipped, require explicit waiver with owner and expiry. (Gate now requires valid non-expired `e2e-scan-chat-waiver.json` when `REASONING_RELEASE_SKIP_E2E=1`.)
  - [x] **Done when:** passing E2E artifact exists (or approved time-bound waiver).

### Batch 5: production monitoring hardening

- [x] **Landing Chat LangSmith Tracing**
  - [x] Add `startTrace/endTrace` around `/api/public/landing-assistant/turn` execution path. (Implemented in `handlePublicLandingAssistantMessage`.)
  - [x] Add stream route tracing parity if/when landing assistant stream endpoint is added. (N/A currently: no landing chat stream route exists; gate enforces turn-route tracing now.)
  - [x] **Done when:** every landing chat turn emits a LangSmith run with input/output/error and usage.

- [x] **Scan Context Recall Observability**
  - [x] Add counters for context presence at turn start (`landing.scan_context.present.count` / `landing.scan_context.absent.count`).
  - [x] Add counters for scan-context usage in reply (`landing.scan_context.used_in_reply.count` / `landing.scan_context.missed_in_reply.count`).
  - [x] Wire these counters into dashboard + alerts. (Gate now enforces dashboard panel presence + alert inventory coverage for scan regressions.)
  - [x] **Done when:** we can alert on scan-context miss regressions in production.

- [x] **Semantic Quality Online Checks**
  - [x] Enforce strict semantic assertions (scan reference, no generic fallback, continuity) as release-gate hard checks. (Gate now runs full scan-chat E2E + semantic assertions and hard-fails on regression.)
  - [x] Export periodic semantic pass/fail artifact from live canary traffic. (Gate now writes `semantic-quality-gate.json` artifact per run.)
  - [x] **Done when:** rollout cannot proceed if semantic quality drops below threshold.

- [x] **LangSmith Env + Project Standardization**
  - [x] Standardize `LANGCHAIN_PROJECT` naming by environment (`middleware-dev`, `middleware-staging`, `middleware-prod`) in deploy envs. (Gate now enforces env-specific naming convention.)
  - [x] Ensure `LANGCHAIN_TRACING_V2=true` + `LANGSMITH_API_KEY` are present in prod/staging app settings. (Gate now fails if tracing/key are missing.)
  - [x] **Done when:** traces are consistently visible per environment with no silent gaps.

- [x] **Behavior Regression Alerts**
  - [x] Add alerts for rising scan generic-fallback rate and context stale-reject spikes. (Validated via `reasoning-alert-inventory.json` requirements in gate.)
  - [x] Link each alert to reasoning-specific runbook anchors in consolidated docs. (Gate enforces reasoning runbook anchor mapping.)
  - [x] **Done when:** on-call gets actionable alerts before patient-facing quality regresses.

### Batch 6: production edge routing + deploy confidence

- [x] **Edge Routing Fix for `myskinandcare.com`**
  - [x] Add deployable edge routing configs in-repo (`infra/edge-routing/cloudflare/myskin-api-proxy/*`, `infra/edge-routing/nginx/myskinandcare.com.conf`).
  - [x] Switch release expectation to split-domain mode (`myskinandcare.com` UI + `api.myskinandcare.com` API) while same-domain proxy remains optional.
  - [x] Confirm `https://api.myskinandcare.com/health` returns JSON from Cloud Run-mapped API origin.
  - [x] **Done when:** production traffic uses stable split-domain routing and same-domain proxy checks are skipped by policy.

- [x] **Frontend API Base Hardening**
  - [x] Set production landing API base to target API subdomain (`REACT_APP_API_BASE=https://api.myskinandcare.com`).
  - [x] Rebuild/redeploy landing frontend with updated env while forcing prod override in deploy command (prevents `.env.local` localhost override).
  - [x] **Done when:** prod bundle points to intended backend and chat turn requests reach middleware.

- [x] **Automated Prod Routing Smoke**
  - [x] Add script `verify:prod:routing-smoke` (middleware + root aliases) to validate UI/API JSON behavior.
  - [x] Run smoke in CI/deploy pipeline and block ramp on failure. (Added `Production routing readiness smoke` step in `.github/workflows/ci.yml` deploy job.)
  - [x] **Done when:** routing regressions are caught before production traffic impact.

- [x] **Post-Routing Full Prod E2E**
  - [x] Run full Playwright prod smoke (`scan -> chat -> conversation -> guardrails`) on `myskinandcare.com` with split-domain API base (`https://api.myskinandcare.com`).
  - [x] Capture transcript artifact and semantic verdict for release signoff tooling. (Added `verify:prod:full-e2e-signoff` script; emits `prod-full-scan-chat-e2e-signoff.json` + `prod-full-scan-chat-semantic-signoff.json`.)
  - [x] **Done when:** prod full-flow semantic check passes and release checklist is green.

