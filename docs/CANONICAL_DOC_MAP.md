# Canonical documentation map (reduce duplicate reading)

Use this when two folders both mention Kelly, checkout, or triage. **Start with the primary doc**; secondaries add depth or a different audience.

| Topic | Read first | Also useful (do not duplicate maintenance) |
|-------|------------|-----------------------------------------------|
| **Kelly phase prompts, Skin & Care intake, orchestrator** | [`middleware-platform/kelly-phase-prompt-architecture.md`](./middleware-platform/kelly-phase-prompt-architecture.md) + [`kelly-god-object-fix-todos.md`](./middleware-platform/kelly-god-object-fix-todos.md) | [`retell-kelly-flow.md`](./middleware-platform/retell-kelly-flow.md); voice prompt text in [`voice-agent/prompts/`](./voice-agent/prompts/) |
| **Kelly + payment / checkout (middleware behavior)** | [`middleware-platform/architecture-kelly-payment.md`](./middleware-platform/architecture-kelly-payment.md) | [`architecture/PUBLIC_AGENTIC_CHECKOUT.md`](./architecture/PUBLIC_AGENTIC_CHECKOUT.md) (product/surface); [`AGENTIC_CHECKOUT_FILE_MAP.md`](./architecture/AGENTIC_CHECKOUT_FILE_MAP.md) (file index) |
| **Checkout runbooks & incidents** | [`middleware-platform/runbook-payment-settlement.md`](./middleware-platform/runbook-payment-settlement.md), [`CHECKOUT_STATE_CONTAMINATION_RUNBOOK.md`](./middleware-platform/CHECKOUT_STATE_CONTAMINATION_RUNBOOK.md) | [`PAYMENT_DATA_INCIDENT_PLAYBOOK.md`](./middleware-platform/PAYMENT_DATA_INCIDENT_PLAYBOOK.md); [`STRIPE_WEBHOOK_PATHS.md`](./middleware-platform/STRIPE_WEBHOOK_PATHS.md) |
| **Voice agent architecture (Retell, tools, coding)** | [`architecture/voice-agent/RUNBOOK.md`](./architecture/voice-agent/RUNBOOK.md) + [`VOICE_AGENT_TODO_AND_STATUS.md`](./architecture/voice-agent/VOICE_AGENT_TODO_AND_STATUS.md) | [`middleware-platform/VOICE_TRIAGE_PARITY.md`](./middleware-platform/VOICE_TRIAGE_PARITY.md); [`RETELL_CONFIG_QUICK_REFERENCE.md`](./middleware-platform/RETELL_CONFIG_QUICK_REFERENCE.md) |
| **Landing Try now + LiveKit (public demo, not provider consult)** | [`architecture/LANDING_TRY_NOW_LIVEKIT.md`](./architecture/LANDING_TRY_NOW_LIVEKIT.md) | [`architecture/VIDEO_CONSULT.md`](./architecture/VIDEO_CONSULT.md) (provider rooms + agents); [`middleware-platform/kelly-phase-prompt-architecture.md`](./middleware-platform/kelly-phase-prompt-architecture.md) (Kelly HTTP) |
| **Repo / service layout** | [`middleware-platform/ARCHITECTURE.md`](./middleware-platform/ARCHITECTURE.md) | [`architecture/ARCHITECTURE_OVERVIEW_AND_COLAB_RAG.md`](./architecture/ARCHITECTURE_OVERVIEW_AND_COLAB_RAG.md) (broader RAG/product) |
| **Derm patient Q&A (RAG pipeline)** | [`architecture/derm-patient-qa/PHASE_0_SCOPE_AND_METRICS.md`](./architecture/derm-patient-qa/PHASE_0_SCOPE_AND_METRICS.md) (then phases 2–5 in same folder) | [`development/KELLY_ENV_AND_DEBUG.md`](./development/KELLY_ENV_AND_DEBUG.md) for env debugging |
| **Richer triage schema / records (gap analysis)** | [`GAP_ANALYSIS_RICHER_TRIAGE_AND_RECORDS.md`](./GAP_ANALYSIS_RICHER_TRIAGE_AND_RECORDS.md) | Patient journey gaps (if present): `PATIENT_BOOKING_AND_TRIAGE_GAPS.md` under architecture when maintained |
| **Doc hygiene / what was merged when** | [`DOCUMENTATION_AUDIT_AND_CONSOLIDATION_PLAN.md`](./DOCUMENTATION_AUDIT_AND_CONSOLIDATION_PLAN.md) (historical consolidation plan) | [`DOC_CLEANUP_MARCH_2026.md`](./DOC_CLEANUP_MARCH_2026.md) (changelog-style summary only) |

## Meta docs (not product runbooks)

| File | Purpose |
|------|---------|
| [`DOCUMENTATION_AUDIT_AND_CONSOLIDATION_PLAN.md`](./DOCUMENTATION_AUDIT_AND_CONSOLIDATION_PLAN.md) | Past audit: overlaps identified, many marked **DONE** — keep for history; do not re-merge without a new ticket. |
| [`DOC_CLEANUP_MARCH_2026.md`](./DOC_CLEANUP_MARCH_2026.md) | Short log of link fixes and archive moves (March 2026). |

## When to delete vs keep

- **Keep** audit/cleanup docs as **history** unless a maintainer explicitly replaces them with a single “docs index” revision.
- **Delete** only when the same content lives verbatim elsewhere (rare); prefer **archive** under `docs/archive/` per `DOC_CLEANUP_MARCH_2026.md`.

**Last updated:** April 7, 2026
