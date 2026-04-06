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

**Completed work (checkout graph, tool-event pipeline, doc/CI review backlog)** is archived: [`archive/Orchestration-todos-completed-2026-04.md`](./archive/Orchestration-todos-completed-2026-04.md).

---

## Pending

### Product / UX / security (ongoing)

- [ ] End-to-end replay of reported user transcripts (QA).
- [ ] Landing ↔ checkout parity: keep `e2e/landing-cta-entry-flows.spec.cjs` in sync with `littlelab-landing` query params.
- [ ] Periodically re-read [`PREDEPLOY_SECURITY_CHECKLIST.md`](../docs/middleware-platform/PREDEPLOY_SECURITY_CHECKLIST.md) + [`PAYMENT_DATA_INCIDENT_PLAYBOOK.md`](../docs/middleware-platform/PAYMENT_DATA_INCIDENT_PLAYBOOK.md); extend redaction for new checkout fields.

### Technical debt

- [ ] Long-term `server.js` route split — follow [`SERVER_JS_REFACTOR_POLICY.md`](../docs/development/SERVER_JS_REFACTOR_POLICY.md) if the team scopes it.
