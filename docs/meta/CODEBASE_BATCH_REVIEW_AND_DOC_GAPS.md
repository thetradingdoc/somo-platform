# Codebase Batch Review And Documentation Gaps

**Last Updated:** April 29, 2026 (gap closure executed)  
**Purpose:** Tracked documentation gap list from a batched code review:
1) whole codebase, 2) `routes/`, 3) `services/`.

---

## Scope And Method

- Reviewed code inventory from:
  - `middleware-platform/`
  - `unified-dashboard/littlelab-landing/src/`
  - `patient-app/`
  - `scripts/`
- Coverage heuristic used for this pass:
  - file is considered "documented" if its filename/path is referenced in `docs/**/*.md`
  - output is used as a **gap signal**, then prioritized manually
- Generated counts in this pass:
  - **Batch 1 (all code files):** 888 scanned, 590 unmentioned
  - **Batch 2 (`middleware-platform/routes`):** 66 scanned, 35 unmentioned
  - **Batch 3 (`middleware-platform/services`):** 278 scanned, 155 unmentioned

> Note: "unmentioned" does not always mean "undocumented behavior", but it does indicate weak discoverability and ownership traceability for developers.

---

## Batch 1 - Codebase-Wide Gaps

### What Is Missing In Docs

- A canonical runtime map from entrypoints to subsystems:
  - API entry (`middleware-platform/server.js`)
  - Landing app entry (`unified-dashboard/littlelab-landing/src/index.js`)
  - Patient app entry (`patient-app/app/_layout.tsx`)
  - ops script control plane (`scripts/`)
- A stable "where to change what" map for high-risk features:
  - triage/assistant flows
  - public checkout and payment
  - geo + plan search
  - payor/payer resolver and precheck paths
- A reproducible doc-maintenance process for keeping code<->docs references fresh.

### Gap Checklist (Batch 1)

- [x] Add `docs/architecture/RUNTIME_ENTRYPOINTS_AND_CALL_PATHS.md`
- [x] Add `docs/development/CODE_OWNERSHIP_BY_SURFACE.md`
- [x] Add `docs/development/SCRIPTS_OPERATIONS_MAP.md`
- [x] Add CI doc check to fail on missing high-level route/service map updates

---

## Batch 2 - Routes Gap List

These route files are currently weakly represented (or absent) in docs references and should be explicitly mapped in middleware docs:

- `middleware-platform/routes/admin-ai-assistant.js`
- `middleware-platform/routes/admin-leads.js`
- `middleware-platform/routes/admin-tenants.js`
- `middleware-platform/routes/ai-templates.js`
- `middleware-platform/routes/auth-tokens.js`
- `middleware-platform/routes/automation.js`
- `middleware-platform/routes/case-report.js`
- `middleware-platform/routes/chat-commands.js`
- `middleware-platform/routes/credits.js`
- `middleware-platform/routes/customer-billing.js`
- `middleware-platform/routes/customer-dashboard.js`
- `middleware-platform/routes/customer-wallet.js`
- `middleware-platform/routes/geo-diagnostics.js`
- `middleware-platform/routes/impact-admin.js`
- `middleware-platform/routes/impact-public.js`
- `middleware-platform/routes/internal-service-ops.js`
- `middleware-platform/routes/invoices.js`
- `middleware-platform/routes/outbound-call.js`
- `middleware-platform/routes/patient-upload-link.js`
- `middleware-platform/routes/prescriptions.js`
- `middleware-platform/routes/pricing.js`
- `middleware-platform/routes/providers.js`
- `middleware-platform/routes/public-checkout-chat.js`
- `middleware-platform/routes/public-face-read.js`
- `middleware-platform/routes/public-geo.js`
- `middleware-platform/routes/qualification-rules.js`
- `middleware-platform/routes/rag-search.js`
- `middleware-platform/routes/rcm.js`
- `middleware-platform/routes/research-bounties.js`
- `middleware-platform/routes/sequences.js`
- `middleware-platform/routes/upload-portal.js`
- `middleware-platform/routes/usage-monitor.js`
- `middleware-platform/routes/usage.js`
- `middleware-platform/routes/voice-agent-settings.js`
- `middleware-platform/routes/workflows.js`

### Gap Checklist (Batch 2)

- [x] Add route prefix -> file ownership table to `docs/middleware-platform/README.md`
- [x] Mark auth/rate-limit expectations per route group
- [x] Tag public vs admin vs internal-only route groups
- [x] Add "new route checklist" section (tests + docs + observability)

---

## Batch 3 - Services Gap List

High-impact service areas currently under-documented for code navigation:

### A) Assistant / Orchestration

- `middleware-platform/services/agent-brain-service.js`
- `middleware-platform/services/agent-turn-reply.js`
- `middleware-platform/services/checkout-graph.js`
- `middleware-platform/services/conversation-state-service.js`
- `middleware-platform/services/degraded-mode-service.js`
- `middleware-platform/services/off-ramp-service.js`
- `middleware-platform/services/reasoning-fsm-service.js`
- `middleware-platform/services/reasoning-job-queue-service.js`
- `middleware-platform/services/reasoning-llm-boundary.js`
- `middleware-platform/services/session-state-store.js`

### B) Security / Compliance / Safety

- `middleware-platform/services/anti-sybil-service.js`
- `middleware-platform/services/redaction-service.js`
- `middleware-platform/services/privacy-governance-service.js`
- `middleware-platform/services/secure-logger.js`
- `middleware-platform/services/semantic-reject-audit-service.js`

### C) Geo / Plan Search / Coverage

- `middleware-platform/services/geo-resolver-service.js`
- `middleware-platform/services/scan-route-response.js`
- `middleware-platform/services/landing-turn-seq.js`
- `middleware-platform/services/landing-voice-metrics-contract.js`
- `middleware-platform/services/nyc-metal-context-service.js`

### D) Payor / Provider Network

- `middleware-platform/services/payor-blocking-service.js`
- `middleware-platform/services/payor-canonicalization-service.js`
- `middleware-platform/services/payor-fuzzy-match-service.js`
- `middleware-platform/services/payor-normalization-service.js`
- `middleware-platform/services/payor-resolution-scoring-service.js`
- `middleware-platform/services/payor-resolution-utils.js`
- `middleware-platform/services/provider-network-drift-quality-service.js`
- `middleware-platform/services/provider-network-precheck-service.js`

### E) Payment / Settlement Reliability

- `middleware-platform/services/financial-integrity-service.js`
- `middleware-platform/services/payment-dispute-service.js`
- `middleware-platform/services/payment-exception-ownership.js`
- `middleware-platform/services/payment-reliability-monitor.js`
- `middleware-platform/services/refund-workflow-service.js`
- `middleware-platform/services/settlement-retry-service.js`
- `middleware-platform/services/settlement-rules-service.js`

### Gap Checklist (Batch 3)

- [x] Add service-domain map to `docs/middleware-platform/README.md`
- [x] Document service dependency boundaries and "data authority" sources
- [x] Add per-domain "entry service" for each subsystem
- [x] Add failure-mode notes for payment/reasoning/payor services

---

## Documentation Update Plan (Priority)

### P0 (now)

- [x] Add route ownership table (prefix -> route file -> guardrails)
- [x] Add service domain map (domain -> key services -> primary docs)
- [x] Add this tracker to docs hub navigation

### P1 (next)

- [x] Create dedicated runtime call-path doc with diagrams
- [x] Add per-domain "how to debug" quick links
- [x] Add docs freshness checks in CI

### P2 (later)

- [x] Add generated docs coverage report script
- [x] Add contributor lint rule requiring docs updates for new route/service files

---

## Closure Summary (2026-04-29)

- Added runtime/ownership/scripts documentation files requested in Batch 1.
- Extended middleware docs with explicit route/service ownership guidance, guardrails, and route checklist.
- Added docs parity automation:
  - `scripts/check-docs-route-service-parity.cjs`
  - `scripts/generate-doc-coverage-report.cjs`
- Wired checks into root npm scripts and CI workflow.

---

## Definition Of Done For This Gap List

- Every route in `middleware-platform/routes/` appears in a maintained ownership map.
- Every critical service domain has a canonical "where it lives" section.
- New engineers can answer "which file owns this behavior?" in under 2 minutes from docs alone.
