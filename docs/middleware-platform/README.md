# Middleware platform documentation

**Canonical location:** All middleware-specific developer docs for this repo live under **`docs/middleware-platform/`** (not inside `middleware-platform/docs/`). The old path is a stub that points here.

This folder is the developer-facing source of truth for Kelly, Skin & Care intake, voice parity, payments/checkout, security runbooks, and related operational guides.

---

## Kelly, phase prompts & Skin & Care

| Doc | Purpose |
|-----|---------|
| [kelly-phase-prompt-architecture.md](./kelly-phase-prompt-architecture.md) | Phase-scoped prompts, `ROUTINE_INTAKE` / `ROUTINE_FOLLOWUP`, orchestrator, tests map |
| [kelly-god-object-fix-todos.md](./kelly-god-object-fix-todos.md) | Checklist, meta contract, success criteria, file map |
| [retell-kelly-flow.md](./retell-kelly-flow.md) | `kelly_flow`, `routine_intake_active`, HTTP/voice activation |
| [skincare-assessment-product-spec.md](./skincare-assessment-product-spec.md) | Assessment product spec and field gates |

### Kelly runbooks & debug

- [runbook-kelly-loops.md](./runbook-kelly-loops.md) — triage/booking loop debugging  
- [debug-llm-kelly-path.md](./debug-llm-kelly-path.md) — LLM path debugging  
- [KELLY_FIX_APPLY_GUIDE.md](./KELLY_FIX_APPLY_GUIDE.md) — applying Kelly fixes  
- [WIRING_GUIDE.md](./WIRING_GUIDE.md) — wiring reference  
- [VOICE_TRIAGE_PARITY.md](./VOICE_TRIAGE_PARITY.md) — voice vs chat triage parity (`REQUIRE_TRIAGE_FOR_VOICE`)

---

## Payments, checkout & Stripe

- [architecture-kelly-payment.md](./architecture-kelly-payment.md) — end-to-end flow and state transitions  
- [runbook-payment-settlement.md](./runbook-payment-settlement.md) — checkout, verify, process-payment troubleshooting  
- [STRIPE_WEBHOOK_PATHS.md](./STRIPE_WEBHOOK_PATHS.md) — webhook routes  
- [CHECKOUT_STATE_CONTAMINATION_RUNBOOK.md](./CHECKOUT_STATE_CONTAMINATION_RUNBOOK.md)  
- [CHECKOUT_UX_QA_CHECKLIST.md](./CHECKOUT_UX_QA_CHECKLIST.md)  
- [CHECKOUT_CHAT_UI_NOTES.md](./CHECKOUT_CHAT_UI_NOTES.md)

---

## Security, privacy & deployment data

- [PREDEPLOY_SECURITY_CHECKLIST.md](./PREDEPLOY_SECURITY_CHECKLIST.md)  
- [PAYMENT_DATA_HANDLING_STANDARD.md](./PAYMENT_DATA_HANDLING_STANDARD.md)  
- [PAYMENT_DATA_INCIDENT_PLAYBOOK.md](./PAYMENT_DATA_INCIDENT_PLAYBOOK.md)  
- [PRIVACY_HARDENING_CHECKLIST.md](./PRIVACY_HARDENING_CHECKLIST.md)  
- [ENDPOINT_SENSITIVITY_INVENTORY.md](./ENDPOINT_SENSITIVITY_INVENTORY.md)  
- [DEPLOYMENT_DATA_CHECKLIST.md](./DEPLOYMENT_DATA_CHECKLIST.md)

---

## Architecture, standards & handoff

- [ARCHITECTURE.md](./ARCHITECTURE.md) — middleware vs dashboards, checkout path, CI pointers  
- [standards.md](./standards.md) — coding and API consistency  
- [test-matrix-handoff.md](./test-matrix-handoff.md) — chat/voice and payment-rail verification matrix  

### Step10 / LangSmith

- [STEP10_LANGSMITH_RUNBOOK.md](./STEP10_LANGSMITH_RUNBOOK.md)  
- [STEP10_PROVIDER_PHONE_ROLLOUT.md](./STEP10_PROVIDER_PHONE_ROLLOUT.md)

---

## Voice, Retell & LangGraph

### Configuration & setup

- [LANGGRAPH_LANGSMITH.md](./LANGGRAPH_LANGSMITH.md) — tracing, scripts, troubleshooting  
- [SIP_AUTH_TROUBLESHOOTING.md](./SIP_AUTH_TROUBLESHOOTING.md)  
- [RETELL_CONFIG_QUICK_REFERENCE.md](./RETELL_CONFIG_QUICK_REFERENCE.md)  
- [RETELL_SIP_CONFIG_FINAL.md](./RETELL_SIP_CONFIG_FINAL.md)  
- [VOICE_CHECKOUT_VERIFICATION.md](./VOICE_CHECKOUT_VERIFICATION.md)

### Configure Retell agent

From repo root:

```bash
cd middleware-platform
node configure-retell.js
```

Requires: server running (or `API_BASE_URL` for production), `RETELL_API_KEY`, `RETELL_AGENT_ID` in `.env`.

### Related (repo-wide)

- [docs/architecture/voice-agent/](../architecture/voice-agent/) — architecture, RUNBOOK, tool schemas  
- [docs/deployment/](../deployment/) — deployment guides  
- [docs/setup/](../setup/) — setup instructions  

---

## Change policy (Kelly / payment)

When changing Kelly triage, Skin & Care intake, or payment behavior:

1. Update the relevant architecture or runbook in this folder.  
2. Keep route/service contracts backward compatible unless explicitly versioned.  
3. Prefer linking from code comments to paths under **`docs/middleware-platform/`** (repo root relative).

---

**Last updated:** April 2026
