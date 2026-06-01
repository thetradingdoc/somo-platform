# Pending todo lists

**Last updated:** May 31, 2026  
**Start here** for active work. Completed checklists live in [`../archive/`](../archive/README.md).

**Also done (code, not a todo file):** P0+P1 codebase hardening — [`docs/architecture/CODEBASE_REVIEW_ROADMAP.md`](../../docs/architecture/CODEBASE_REVIEW_ROADMAP.md) (commit `139f424`).

---

## Tier 1 — Active product / engineering

| File | Focus |
|------|--------|
| [`KELLY_CONVERSATION_RAILS_TODOS.md`](KELLY_CONVERSATION_RAILS_TODOS.md) | F2 full visit E2E; Sprint 4–5 provider UI + money maturity |
| [`KELLY_RCM_PIPELINE_TODOS.md`](KELLY_RCM_PIPELINE_TODOS.md) | Kelly identity + RCM backbone + financial rails (TODO-01–24) |
| [`AGENTIC_CHECKOUT_UI_AND_BACKEND_TODOS.md`](AGENTIC_CHECKOUT_UI_AND_BACKEND_TODOS.md) | Open checkout debt (#2, #4–#7, #9–#10, #12) |
| [`Step10-LangChain-LangGraph-LangSmith-todos.md`](Step10-LangChain-LangGraph-LangSmith-todos.md) | Step 10 LangGraph + guardrails (blocked on checkout payment-rail prereqs) |
| [`DERM_PATIENT_QA_REDDIT_PIPELINE_TODOS.md`](DERM_PATIENT_QA_REDDIT_PIPELINE_TODOS.md) | Derm Q&A UI (Phase 8), eval/CI (Phase 6), ops (Phase 7) |

---

## Tier 2 — Production / infra / compliance

| File | Focus |
|------|--------|
| [`PRODUCTION_READINESS_TASKS.md`](PRODUCTION_READINESS_TASKS.md) | Azure, HIPAA, deploy, monitoring evergreen checklist |
| [`TELEMEDICINE_TODOS.md`](TELEMEDICINE_TODOS.md) | Video consult completion, JWT, case-report pipeline |
| [`CLEAN_PUSH_GCP_TODOS.md`](CLEAN_PUSH_GCP_TODOS.md) | Post-commit deploy + smoke + rollback (5 items open) |
| [`PAYOR_ENTITY_RESOLUTION_TODOS.md`](PAYOR_ENTITY_RESOLUTION_TODOS.md) | Vendor exports, review UI, canonical resolver rollout |

---

## Tier 3 — Small ongoing / launch hygiene

| File | Focus |
|------|--------|
| [`Orchestration-todos.md`](Orchestration-todos.md) | Transcript replay QA, landing↔checkout E2E parity, security checklist refresh |
| [`DODGECALL_DEMO_LAUNCH_CHECKLIST.md`](DODGECALL_DEMO_LAUNCH_CHECKLIST.md) | Human/ops P0 before first demo call (code complete) |
| [`LANDING_NAVIGATOR_REGRESSION_TODOS.md`](LANDING_NAVIGATOR_REGRESSION_TODOS.md) | ZIP race/scope regression tests (UI otherwise done) |
| [`PHOTO_TO_BILL_EXTRACTION_TODOS.md`](PHOTO_TO_BILL_EXTRACTION_TODOS.md) | Key rotation + Phase 5 rollout only |

---

## Archived from pending (May 31, 2026)

| Was pending | Now |
|-------------|-----|
| Voice billing, provider trial SIM, journal V1 | [`../archive/VOICE_BILLING_*`](../archive/VOICE_BILLING_SUBSCRIPTION_TODOS_COMPLETED_2026-05-31.md), [`PROVIDER_TRIAL_SIM_*`](../archive/PROVIDER_TRIAL_SIM_TODOS_COMPLETED_2026-05-31.md), [`PATIENT_APP_JOURNAL_*`](../archive/PATIENT_APP_JOURNAL_REDESIGN_V1_COMPLETED_2026-05-31.md) |
| Kelly golden path (Sprints 0–3) | [`../archive/KELLY_CONVERSATION_RAILS_GOLDEN_PATH_COMPLETED_2026-05-31.md`](../archive/KELLY_CONVERSATION_RAILS_GOLDEN_PATH_COMPLETED_2026-05-31.md) |
| Agentic reasoning (unified pipeline) | [`../archive/AGENTIC_REASONING_TODOS_COMPLETED_2026-05-31.md`](../archive/AGENTIC_REASONING_TODOS_COMPLETED_2026-05-31.md) |
| Landing navigator UI (Batches 1–14) | [`../archive/LANDING_NAVIGATOR_UI_UX_TODOS_COMPLETED_2026-05-31.md`](../archive/LANDING_NAVIGATOR_UI_UX_TODOS_COMPLETED_2026-05-31.md) |
| DodgeCall demo agent (code) | [`../archive/DODGECALL_DEMO_AGENT_TODOS_COMPLETED_2026-05-31.md`](../archive/DODGECALL_DEMO_AGENT_TODOS_COMPLETED_2026-05-31.md) |
| Derm Q&A backend (Phases 0–5) | [`../archive/DERM_PATIENT_QA_BACKEND_COMPLETED_2026-05-31.md`](../archive/DERM_PATIENT_QA_BACKEND_COMPLETED_2026-05-31.md) |

---

## Notes

- Do not add VS Code `.code-workspace` files under `todos/`.
- For doc overlap, see [`docs/meta/CANONICAL_DOC_MAP.md`](../../docs/meta/CANONICAL_DOC_MAP.md).
