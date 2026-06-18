# Somo — all pending work

**Last updated:** 2026-06-17  
**SSOT:** This file is the single entry point for open work. Detail appendix: [`docs/CUSTOMER_READY_BACKLOG.md`](../docs/CUSTOMER_READY_BACKLOG.md) (CR/FE items with file paths).

**Active Cursor plans:** `~/.cursor/plans/` — 12 files (demo Phase 1, architecture gaps, CRM, voice billing, deploy, etc.)

---

## P0 — Revenue (demo Phase 1 conversion)

**Plan:** `~/.cursor/plans/demo_phase1_hitl_conversion.plan.md`

### Landing form (L)

- [ ] **L-01** Add email field to landing demo form (`DemoSection.jsx`)
- [ ] **L-02** Add Cloudflare Turnstile to demo form
- [ ] **L-03** Persist email on `somo_demo_requests` + migration
- [ ] **L-04** Create `somo-demo-email.js` (replace SMS signup link)
- [ ] **L-05** Update consent copy and prompt for email (not SMS)

### Data bridge (D)

- [ ] **D-01** `upsertLeadFromDemoRequest` → `leads` table with `source=landing_demo`

### Script rewrite (S)

- [ ] **S-01** Form-aware opener (name, practice type, specialty from submission)
- [ ] **S-02** Slot gates — no booking without available slots tool result
- [ ] **S-03** Roleplay VALUE segment — demonstrate Kelly, not describe
- [ ] **S-04** Hard-stop `send_signup_email` at end (not SMS)
- [ ] **S-05** Remove Sam persona — Kelly only in `voice-incoming-handler.js`
- [ ] **S-06** Rewrite `demo-voice-prompt.md` per qualification playbook

### Post-call + landing UX (C)

- [ ] **C-01** Post-call signup email with branded template
- [ ] **C-02** Sync demo lead status to admin CRM after call
- [ ] **C-03** Record qualification fields on lead row
- [ ] **C-04** Landing success UX — remove signup button; email confirmation message
- [ ] **C-05** E2E test landing form → lead row → call mock

### Admin inbound demos (A)

- [ ] **A-01** Admin pipeline inbound demos lane UI
- [ ] **A-02** API filter leads by `source=landing_demo`
- [ ] **A-03** Lead detail shows demo call transcript + qualification
- [ ] **A-04** Admin E2E inbound demo lead appears after form submit

---

## P0 — Customer-ready prod gates

Full detail + file paths: [`docs/CUSTOMER_READY_BACKLOG.md`](../docs/CUSTOMER_READY_BACKLOG.md)

### P0-A Production enforcement

- [ ] **CR-001** `partial` — Run `verify:kelly-rails-cloudrun` on live `somo-middleware`; document revision + env in OPERATIONS.md
- [ ] **CR-002** `partial` — Confirm `CONVERSATION_MODE_ROUTING=enforce` (not `shadow`) on prod Cloud Run
- [ ] **CR-003** `open` — Enable `CONVERSATION_MODE_ENFORCE_TENANT_INBOUND_ADMIN=1` after 48h clean shadow telemetry
- [ ] **CR-004** `partial` — Confirm `KELLY_RAILS_V2=1`, `KELLY_RAILS_ROLLOUT_PCT=1`, `KELLY_ALLOW_HYBRID_GRAPH=0`
- [ ] **CR-005** `partial` — Wire cloudrun verify into post-deploy; fail deploy on shadow

### P0-B Hard transactional gates

- [ ] **CR-007** `partial` — Remove transactional tools from LLM allowlist on `confirm_visit`, `cancel_execute`, `pay_invoice`
- [ ] **CR-008** `partial` — Gate-owned reply only; LLM must not invent confirmation when gate returns `reply`
- [ ] **CR-009** `open` — Unit test: confirm utterance without `tool_completed` → no `booking_confirmed` key

### P0-C Live verify scripts

- [ ] **CR-010** `partial` — `verify:live-booking-call` mandatory after voice deploy
- [ ] **CR-011** `open` — Create `verify-live-copay-call.cjs`
- [ ] **CR-012** `open` — Create `verify-live-cancel-call.cjs`
- [ ] **CR-013** `open` — Create `verify-live-reschedule-call.cjs`
- [ ] **CR-014** `open` — Create `verify-live-visit-checkout.cjs`

### P0-D Signup → live line

- [ ] **CR-015** `partial` — Automated test: `provisionSaasTenant` creates merchant + clinic + `prompt_profile` + `voice_agent_settings`
- [ ] **CR-016** `partial` — Twilio number + Retell agent assign path (auto or documented ops)
- [ ] **CR-018** `open` — Seed `visit_pricing` in `provisionSaasTenant` per use case/specialty
- [ ] **CR-019** `partial` — Stripe merchant ready at provision, not lazy on first checkout
- [ ] **CR-020** `partial` — `trial-activation.html` gates "Call my line" on `kelly/status` ready + real number

### P0-E Telemetry truth

- [ ] **CR-021** `partial` — Score/TCR uses `tool_completed` from executor, not subrail `toolsUsed`
- [ ] **CR-022** `partial` — `orchestration_trace` completeness audit
- [ ] **CR-023** `partial` — Activity feed primary on `tool_completed` + `appointment_booked`

### P0 — Frontend

- [ ] **FE-001** `partial` — `data-testid` hooks on all 6 primary pages (add `patients.html`)
- [ ] **FE-013** `partial` — Wire `provider-api.js` on agent, calendar, revenue, patients

### P1 — Core flows

- [ ] **CR-024** `open` — Fix Spanish booking prod flake (`triage_session_id` uniqueness + GCS SQLite contention)
- [ ] **CR-025** `open` — `sandbox-spanish-green`: 3× consecutive 14/14 TCR
- [ ] **CR-026** `open` — Per-tenant `policy_json` in `prompt_profiles.metadata`
- [ ] **CR-027** `open` — Provider availability admission gate when `get_available_slots` empty
- [ ] **CR-028** `open` — `auto-checkout-after-schedule` default on for SaaS tenants
- [ ] **CR-029** `runbook` — Live prod booking acceptance documented in OPERATIONS.md
- [ ] **CR-030** `runbook` — Prod live cancel → `verify:live-cancel-call` PASS
- [ ] **CR-031** `runbook` — Prod live reschedule → `verify:live-reschedule-call` PASS
- [ ] **CR-032** `open` — Same-day cancel + rebook prod smoke
- [ ] **CR-033** `partial` — Cancellation subrail intents only; no phantom `toolsUsed`
- [ ] **CR-034** `partial` — `seedModeAtCallStart` for `tenant_billing` on copay first utterance
- [ ] **CR-035** `open` — Sticky `preferred_language` on payment gate replies
- [ ] **CR-036** `runbook` — Prod live copay → `verify:live-copay-call`
- [ ] **CR-037** `runbook` — Prod book → checkout → pay on `patients/pay.html`
- [ ] **CR-039** `open` — `hydrateSessionForTurn(sessionId)` merge projection + meta_kv + triage
- [ ] **CR-040** `open` — OPQRST → booking pivot syncs `triage_sessions` into projection
- [ ] **CR-041** `partial` — Turn-planner audit: cancel/records/copay intents from subrails only
- [ ] **CR-042** `open` — Telemetry SLO: `orchestration_trace_gap` < 1% documented in OPERATIONS.md
- [ ] **CR-043** `partial` — Call detail forensics in portal
- [ ] **CR-044** `partial` — Activity feed: cancel + reschedule + payment events consistently
- [ ] **CR-045** `open` — Calendar reflects voice-booked appts within 30s
- [ ] **CR-046** `open` — Revenue tab: `voice_checkouts` + RCM payments scoped to clinic
- [ ] **CR-047** `partial` — `test:prod:provider-portal` npm script + post-login smoke
- [ ] **FE-008** `partial` — `patient-case.html` provider shell + `?patient_id=` auto-load
- [ ] **FE-010** `partial` — "Booked by Kelly" badge (Today done; calendar rows open)
- [ ] **FE-019** `partial` — Expand prod Playwright smoke (login + Today; post-login Kelly check)

### P2 — Scale

- [ ] **CR-048** `partial` — Signup specialty/use case → `prompt_profile` template + `visit_pricing` seed
- [ ] **CR-049** `partial` — Self-serve Twilio assign-line in signup flow
- [ ] **CR-050** `partial` — Google Calendar sync double-book prevention E2E
- [ ] **CR-051** `open` — `verify-call-opener-parity.cjs` — settings greeting matches live opener
- [ ] **CR-052** `partial` — `SAAS_VOICE_FAIL_CLOSED=1` prod verify + runbook
- [ ] **CR-053** `open` — `prompt-bounding-locale` — merged subrail objectives + locale lock
- [ ] **CR-054** `partial` — All deterministic gate strings EN/ES/ZH
- [ ] **CR-055** `open` — ASR low-confidence → clarify prod monitor script
- [ ] **CR-056** `partial` — OPQRST → book sandbox chain + prod runbook
- [ ] **CR-057** `partial` — Emergency rail prod spot-check (911, no booking pivot)
- [ ] **CR-058** `open` — `verify-live-records-call.cjs`
- [ ] **CR-059** `partial` — Operator outbound stable TCR + prod test call runbook
- [ ] **CR-060** `partial` — Outbound opener → `call_opener_used` in `kelly_call_events`
- [ ] **CR-061** `open` — `verify-env-gates.cjs` in CI (fail prod profile with `shadow`)
- [ ] **CR-062** `partial` — Nightly `verify:kelly-rails-prod-runtime` workflow
- [ ] **CR-063** `open` — GCS SQLite contention monitor + alert doc
- [ ] **CR-064** `open` — Post-call owner email (booked / cancelled / payment link)
- [ ] **CR-065** `partial` — Rollback runbook tested (<15 min)
- [ ] **FE-016** `open` — Split `settings.html` into tab modules
- [ ] **FE-017** `open` — Patient notes composer UI + wire `PATCH` notes API
- [ ] **FE-018** `open` — Mobile responsive pass (calendar + revenue)
- [ ] **FE-020** `open` — Remove 15 redirect stub HTML after Firebase rewrite rules

### P3 — Deferred (out of P0–P2 scope)

- [ ] **CR-066** `open` — SSOT Postgres-primary when `KELLY_RAILS_SSOT_POSTGRES=1`
- [ ] **CR-067** `open` — Live Kelly turn stream on provider shell
- [ ] **CR-068** `open` — Video visit SMS after booking
- [ ] **CR-069** `open` — EHR sync optional for v1 pilot
- [ ] **CR-070** `open` — Admin CRM separate from clinic portal
- [ ] **CR-071** `open` — Analytics dashboard deferred
- [ ] **CR-072** `open` — General pay-any-invoice voice path deferred

---

## P1 — Demo operator sign-off

- [ ] **UI-07** Visual sign-off 390px + 1280px on callsomo.com (hard-refresh)
- [ ] **Q-17** Manual EN live call — 5 Sheets event types (if `SOMO_SHEETS_*` configured)
- [ ] **Q-18** Manual ES live call — Spanish throughout

**Docs:** [`docs/agent/somo-demo/RUNBOOK.md`](../docs/agent/somo-demo/RUNBOOK.md), [`QUALIFICATION_PLAYBOOK.md`](../docs/agent/somo-demo/QUALIFICATION_PLAYBOOK.md)

---

## P1 — Kelly Phase C sign-off

Engineering ~complete; human/staging proof required. Reference: [`docs/runbooks/KELLY_PHASE_C_STAGING.md`](../docs/runbooks/KELLY_PHASE_C_STAGING.md)

### P0 — Sign-off blockers

- [ ] **C-P0-01** Complete OPQRST review packet; Spanish copy for `config/clinical-opqrst/es.json`
- [ ] **C-P0-02** Add `docs/clinical/OPQRST_ES_SIGNOFF_<date>.md`
- [ ] **C-P0-03** Populate `es.json` from approved text (no auto-translate in prod)
- [ ] **C-P0-04** EN cohort: 10 happy-path calls per scorecard
- [ ] **C-P0-05** ES cohort: 10 happy + 5 noisy + 5 low-confidence opener
- [ ] **C-P0-06** Demo dry-run EN + ES per healthcare specialist scenario
- [ ] **C-P0-07** Flip EXECUTION status to complete; all exit criteria met

### A — Language detection (staging)

- [ ] **C-A-01** Staging chat first Spanish utterance
- [ ] **C-A-02** Staging voice first Spanish on Retell
- [ ] **C-A-03** Low-confidence non-English opener
- [ ] **C-A-04** `verify:kelly-rails-runtime-event.cjs` for proof sessions

### B — Spanish prompts and Retell

- [ ] **C-B-01** `RETELL_VOICE_ID_ES`, `RETELL_CONFIGURE_LOCALE=es` on staging
- [ ] **C-B-02** Staging Spanish happy path (rash → clinical in Spanish)
- [ ] **C-B-03** Prod policy: `KELLY_RAILS_ES_ENABLED=1` only with OPQRST sign-off

### C — OPQRST (post sign-off)

- [ ] **C-C-01** `KELLY_OPQRST_ES_PACK=v1` on staging; voice clinical uses registry
- [ ] **C-C-02** ES Jest snapshots after sign-off

### D — ASR gate

- [ ] **C-D-01** Retell spike; document payload fields in staging runbook
- [ ] **C-D-02** `KELLY_ASR_MIN_CONFIDENCE` on staging; clarify + mid-call handoff
- [ ] **C-D-03** If no confidence metadata: record gate no-op in runbook

### E — Language mismatch

- [ ] **C-E-01** SQL proof for `language_mismatch` from resolver, orchestrator, ASR
- [ ] **C-E-02** Admin API or SQL-only decision for language-mismatch queries

### F — Voice quality

- [ ] **C-F-01** Post-call voice-metrics curl for demo `callId`
- [ ] **C-F-02** Archived scorecards + median ≥ pass bars

### Carryover

- [ ] **B-OPS-01** `today.html` activity feed screenshot after v2 flow
- [ ] Kelly rails: manual `today.html` activity feed (operator screenshot) — Phase B V6-3

---

## P2 — Engineering backlogs

### Kelly RCM pipeline (TODO-01–24)

**SSOT:** [`docs/architecture/KELLY_AGENTIC_RAILS_TARGET_AND_BUILD_PLAN.md`](../docs/architecture/KELLY_AGENTIC_RAILS_TARGET_AND_BUILD_PLAN.md)

Open roadmap items: TODO-01–04 (P0 Kelly status/provisioning), TODO-05–07 (journey backbone), TODO-08–16 (timeline, ledger, payments), TODO-18/20/24 (deferred command center). Playwright-driven UI consistency gaps: provider shell on all pages, theme/icon normalization, legacy commerce traces.

### Kelly Phase B+ (deferred product)

- [ ] Video visit SMS after booking
- [ ] Provider portal deep link in `post_payment` lane
- [ ] Richer in-call provider dashboard updates
- [ ] Optional: live Kelly turn stream on provider shell

### Telemedicine

- [ ] E2E smoke book → video → case report
- [ ] **P1** Enforce JWT for FHIR/DiagnosticReport in production (`REQUIRE_JWT_FOR_FHIR=1` startup guard)
- [ ] **P1** JWT issuer endpoints (`POST /api/auth/patient-token`, `POST /api/auth/clinician-token`)
- [ ] **P2** Set `session_metadata.appointment_id` in video-consult routes
- [ ] **P2** Case report service strict config vs stub mode flag
- [ ] **P2** Case report service auth on `POST /report`
- [ ] **P2** Internal transcript endpoint for case report service
- [ ] **P2** Case report pipeline Layer 1 (non-stub)
- [ ] **P3** E2E test for transcript-only path
- [ ] **P3** Double-trigger guard for `trigger_case_report`

### GCP deploy smoke

- [ ] Execute deploy with checklist and capture output
- [ ] Post-deploy smoke (`/health`, `/api`, payor/public routes, critical UI flow)
- [ ] Record rollback plan: prior commit SHA + rollback command

### Payor entity resolution

- [ ] Production source acquisition (vendor exports — blocked on customer-provided export files)
- [ ] Expand integration tests over time

### Photo-to-bill extraction

- [ ] Rotate exposed `OPENAI_API_KEY` — [`docs/runbooks/PHOTO_TO_BILL_KEY_ROTATION.md`](../docs/runbooks/PHOTO_TO_BILL_KEY_ROTATION.md)
- [ ] Rotate exposed Google service account credentials
- [ ] Update env templates with required billing + GCS variables
- [ ] Add/refresh photo-to-bill operations runbook
- [ ] Execute staged rollout checks (internal → beta → public)
- [ ] Physical device validation: real photo → upload → OCR → review → confirm → Timeline

### Provider Today UI polish

- [ ] Revenue nav consolidation in `PORTAL_NAV_BASE`
- [ ] Real unread counts from patient inbox API
- [ ] Remove inline style-heavy modal markup from `calendar.html` into shared CSS
- [ ] Replace legacy inline `onclick` handlers with delegated JS listeners
- [ ] Normalize topbar action labels across today/calendar/agent
- [ ] Empty-state actions for calls/messages panels in `today.html`
- [ ] Convert hardcoded button colors in `calendar.html` to Somo token classes
- [ ] Mobile loading skeleton variants for dashboard panels
- [ ] Aria-live success status region for settings saves in `agent.html`

### Orchestration QA

- [ ] End-to-end replay of reported user transcripts
- [ ] Landing ↔ checkout parity E2E (legacy funnel — low priority)
- [ ] Periodically re-read predeploy security checklist + payment incident playbook
- [ ] Long-term `server.js` route split (if team scopes it)

### Somo demo prod gaps (Phase B)

- [ ] Google Sheets outbound telemetry sink (if analytics required)
- [ ] Re-verify duplicate phone throttling on deployed production host
- [ ] Qualification fields persisted and exported
- [ ] Authoritative scenario runner for outbound sales
- [ ] Outcome taxonomy standardization; per-scenario evidence collector; ops dashboard alignment

### RCM master backlog (open items)

- Claims status filter tabs (open/denied/paid client filter)
- GitHub secrets on somo-platform (`gh secret set` per runbook)

---

## P3 — Deferred / blocked / legacy

### Agentic checkout (commerce-adjacent)

Open: #2, #4–#7, #9–#10, #12 — webhook convergence, shipping address, quote linkage, orphaned sessions, merchant-orders UI, tool-only silence, post-payment chat context.

### LangGraph Step 10

Blocked on checkout payment-rail prereqs. Open: sections 1.1–1.7, 2.1–2.7, 3.1–3.6, 4.1–4.6 (guardrails, graph skeleton, LangSmith, API, rollout).

### Derm patient Q&A (consumer education — DEFERRED)

P1.4 clinician spot-check; P8 UI (chat surface, clarifying questions, disclaimers, escalation, citations, feedback, image upload, a11y); P6 eval runner/metrics/CI/online; P7 corpus versioning, conflict policy, incident playbook.

### Landing navigator ZIP regression (legacy funnel — DEFERRED)

- [ ] Add regression tests for race conditions and scope correctness

### Somo demo launch checklist (ops — mostly stale)

- [ ] Audition female voice; set `SOMO_DEMO_VOICE_ID`
- [ ] ADR signed for custom LLM WebSocket
- [ ] Document `use_case` vs `template_id`
- [ ] Playbook outline reviewed
- [ ] Public `API_BASE_URL` reachable from Twilio
- [ ] Acceptance smoke: demo disabled, no KellyAgentService on demo path, E2E + unit tests pass

### Production readiness (evergreen / historical Azure)

Azure sections in legacy checklist are historical; use GCP runbooks: [`docs/deployment/SOMO_CLOUD_RUN_DEPLOY.md`](../docs/deployment/SOMO_CLOUD_RUN_DEPLOY.md), [`docs/runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md`](../docs/runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md).

---

## Summary

| Priority | Workstream | ~Open items |
|----------|------------|-------------|
| **P0** | Demo Phase 1 conversion | 27 |
| **P0** | Customer-ready CR/FE | ~73 |
| **P1** | Demo operator sign-off | 3 |
| **P1** | Kelly Phase C sign-off | ~24 |
| **P2** | RCM, telemedicine, payor, GCP, photo-to-bill, UI polish | ~40 |
| **P3** | Commerce checkout, LangGraph, derm Q&A, legacy funnel | deferred |
