# Kelly Conversation Rails — Backlog

Status: **Kelly Rails V2** landed (2026-06-02); F2 full green pending local LLM run

**Full build plan (SSOT):** [`docs/architecture/KELLY_AGENTIC_RAILS_TARGET_AND_BUILD_PLAN.md`](../../docs/architecture/KELLY_AGENTIC_RAILS_TARGET_AND_BUILD_PLAN.md)

Completed golden-path work (Sprints 0–3, F1b/F1c/Playwright skip-triage):  
[`../archive/KELLY_CONVERSATION_RAILS_GOLDEN_PATH_COMPLETED_2026-05-31.md`](../archive/KELLY_CONVERSATION_RAILS_GOLDEN_PATH_COMPLETED_2026-05-31.md)

Phases 2–7 patch layer (superseded on v2 path):  
[`../archive/KELLY_AGENTIC_RAILS_PHASE_2_7_COMPLETED_2026-06-01.md`](../archive/KELLY_AGENTIC_RAILS_PHASE_2_7_COMPLETED_2026-06-01.md)

**V2 rebuild (authoritative when `KELLY_RAILS_V2=1`):**  
[`../archive/KELLY_AGENTIC_RAILS_V2_REBUILD_2026-06-02.md`](../archive/KELLY_AGENTIC_RAILS_V2_REBUILD_2026-06-02.md) · [`../../docs/architecture/kelly_rails_v2_as_built.md`](../../docs/architecture/kelly_rails_v2_as_built.md)

## Active execution (see build plan checklist)

- **E7-1:** F2 cold start T1–T6 green locally (`KELLY_RAILS_V2=1`, LLM keys, server :4000)
- **V6-3:** Manual staging — verify provider-shell clinical prep + `rcm.html` with booked appointment (no Stripe required)

## Sprint 4 — Provider UI (partial)

- TODO-03/04 in `provider-shell.js` (verify in staging)
- TODO-08/15/16: `rcm.html` + `today.html` (exist; verify)
- E1: legacy dashboard redirects (done)

## Sprint 5 — Money maturity (partial)

- Track in [`KELLY_RCM_PIPELINE_TODOS.md`](KELLY_RCM_PIPELINE_TODOS.md) (TODO-09/13/14/20)
- G1–G3 done per golden-path archive

## Optional

- Playwright full golden + `RCM_E2E_STRIPE_LIVE=1`
- CI in `run-rcm-e2e-suite.cjs` after F2 green
