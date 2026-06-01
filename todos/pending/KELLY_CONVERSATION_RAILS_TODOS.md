# Kelly Conversation Rails — Backlog

Status: golden path complete; S4–S5 + secondary rails pending

Completed golden-path work (Sprints 0–3, F1b/F1c/Playwright skip-triage, fixture spec, E2E env):  
[`../archive/KELLY_CONVERSATION_RAILS_GOLDEN_PATH_COMPLETED_2026-05-31.md`](../archive/KELLY_CONVERSATION_RAILS_GOLDEN_PATH_COMPLETED_2026-05-31.md)

## Open backlog

### F2 full visit (Node)

- F2 `test:e2e:rcm:conversation` T1–T4: Step1 skincare clarifier skip when `routine_intake_active=0` + clinic derm/booking intent (`_skipStep1SkinClarifierForClinicVisit` in `kelly-agent-service.js`)
- Re-run: `npm run test:e2e:rcm:conversation`

### Sprint 4 — Provider UI (partial)

- TODO-01/02 shipped (`routes/kelly.js`)
- TODO-03/04 in `provider-shell.js` (verify in staging)
- TODO-08/15/16: `rcm.html` command center + `today.html` payment summary fetch exist
- E1: legacy pages `business-dashboard.html`, `commerce-billing.html` redirect to canonical routes

### Sprint 5 — Money maturity (partial)

- G1 idempotency policy + test
- G2 rollback doc: [`docs/RCM/RCM_LEDGER_ROLLBACK.md`](../../docs/RCM/RCM_LEDGER_ROLLBACK.md)
- G3 tenant isolation test: `__tests__/rcm-tenant-isolation.test.js`
- TODO-09/13/14/20: track in [`KELLY_RCM_PIPELINE_TODOS.md`](KELLY_RCM_PIPELINE_TODOS.md)

### Later — Secondary rails (stubs)

- B2 `isRescheduleCancelIntent` in orchestrator (intent routing hook)
- B3–B6, D1–D7, TODO-18/24: deferred; implement per-rail E2E when touched

### Optional follow-ups

- Playwright full golden with `RCM_E2E_STRIPE_LIVE=1` (Layer 3 live Stripe on `pay.html`)
- CI wiring in `run-rcm-e2e-suite.cjs` after first full green run
