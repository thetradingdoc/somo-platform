# Somo — all pending work

**Last updated:** 2026-06-18  
**Engineering status:** Demo Phase 1, RS-0/1, most CR gates complete. Open: operator prod verify, Kelly Phase C, RS-2 deferred refactors, P2 polish.

**Active epic:** [VOICE-SITE-ESC-EPIC.md](./VOICE-SITE-ESC-EPIC.md) — CallSiteContext (L1.5), escalation ladder, migrations 061–074, post-epic review train.

**Active remediation train:** [VOICE-REMEDIATION-TRAIN.md](./VOICE-REMEDIATION-TRAIN.md) — R-01–R-13 (33 audit issues + gap tracks).

### Post-epic review (T-001–T-018)

Code landed in post-review train; operator gates still open:

- **T-001** — Staging Retell transfer PSTN ring verify (before prod escalation)
- **T-011** — Run `verify-tenant-columns-null-free.cjs` on target DB before migration 074
- **T-013 / T-014** — `voice-routing-matrix-live.cjs --tenant-book` / `--fail-closed`
- **T-015 / T-016** — Staging + prod deploy per OPERATIONS.md
- **Deferred:** SITE-12 full location resolver; meta_kv phase 2 (all call sites)

**SSOT:** This file is the single entry point for open work.

---

## Blocked — operator (cannot complete in code)

These require live prod/staging access, human QA, or clinical sign-off:

- **UI-07, Q-17, Q-18** — visual + live call sign-off on callsomo.com
- **Kelly Phase C (C-P0-01…C-F-02)** — clinical OPQRST review + staging voice cohorts → [R-09](./VOICE-REMEDIATION-TRAIN.md#r-09--p1-spanish--kelly-phase-c-c-p0-01-07-cr-025)
- **CR-001–005** — run `verify:kelly-rails-cloudrun` on live Cloud Run + flip enforce flags after telemetry
- **CR-029–037, CR-030–032** — execute live verify scripts against prod (`docs/deployment/OPERATIONS.md`)
- **CR-024–025** — Spanish prod flake: run `sandbox-spanish-green` 3× on staging
- **CR-047, FE-019** — prod portal smoke with `PW_PROVIDER_EMAIL` / `PW_PROVIDER_PASS`
- **GCP deploy smoke, photo-to-bill key rotation, payor vendor exports** — operator runbooks
- **RS-2-02…RS-2-07** — multi-week refactors (deferred)


## P0 — Revenue (demo Phase 1 conversion)

**Plan:** `~/.cursor/plans/demo_phase1_hitl_conversion.plan.md`

### Landing form (L)

- [x] **L-01** Add email field to landing demo form (`DemoSection.jsx`)
- [x] **L-02** Add Cloudflare Turnstile to demo form (when `VITE_SOMO_DEMO_TURNSTILE_SITE_KEY` set)
- [x] **L-03** Persist email on `somo_demo_requests` + migration
- [x] **L-04** Create `somo-demo-email.js` (replace SMS signup link)
- [x] **L-05** Update consent copy and prompt for email (not SMS)

### Data bridge (D)

- [x] **D-01** `upsertLeadFromDemoRequest` → `leads` table with `source=landing_demo`

### Script rewrite (S)

- [x] **S-01** Form-aware opener (name, practice type, specialty from submission)
- [x] **S-02** Slot gates — no booking without available slots tool result
- [x] **S-03** Roleplay VALUE segment — demonstrate Kelly, not describe
- [x] **S-04** Hard-stop `send_signup_email` at end (not SMS)
- [x] **S-05** Remove Sam persona — Kelly only in `voice-incoming-handler.js`
- [x] **S-06** Rewrite `demo-voice-prompt.md` per qualification playbook

### Post-call + landing UX (C)

- [x] **C-01** Post-call signup email with branded template
- [x] **C-02** Sync demo lead status to admin CRM after call
- [x] **C-04** Landing success UX — remove signup button; email confirmation message
- [x] **C-03** Record qualification fields on lead row
- [x] **C-05** Unit + E2E: `somo-demo-lead-bridge.test.js`, `admin-inbound-demo-leads.test.js`, `e2e/somo-landing.spec.cjs` (email field, no signup CTA)

### Admin inbound demos (A)

- [x] **A-01** Admin pipeline inbound demos lane UI
- [x] **A-02** API filter leads by `source=landing_demo`
- [x] **A-03** Lead detail shows demo call transcript + qualification
- [x] **A-04** Admin inbound demo lead filter — `admin-inbound-demo-leads.test.js` (`getAllLeads?source=landing_demo`)

---

## P0 — Codebase & database structure

**Source:** Codebase structure audit (2026-06-18) — split-brain SQLite, fragmented startup scripts, 21k-line `database.js` god file.

**Target layout (minimal):** all local `.db` under `middleware-platform/var/db/`; canonical dev entry `scripts/dev/run.sh`; geo CSV under `data/geo/`.

### Phase 0 — Fix now (RS-0)

- [x] **RS-0-01** Unify dev DB: archive/delete stale root `middleware-dev.db*` and `middleware-test.db`; standardize `DB_PATH=./var/db/middleware-dev.db`
- [x] **RS-0-02** Update `DB_PATH` in `run`, `.env.example`, `cypress.config.js`, and `docs/Database/OPERATIONS.md` to match `var/db/`
- [x] **RS-0-03** Add startup warning when SQLite basename matches but path/size diverges from expected `var/db/` location
- [x] **RS-0-04** Restore or remove broken `scripts/verify-repo-layout.cjs` (referenced in root `package.json`)
- [x] **RS-0-05** Fix stale `middleware.db` paths in `backup-database.js`, `add-payment-method-column.js`, `migrate-add-payment-method.js`
- [x] **RS-0-06** Make `scripts/dev/run.sh` canonical local dev entry (from root `run`); `chmod +x`; remove stale jeremiahrichie path and duplicate kill blocks
- [x] **RS-0-07** Deprecate `middleware-platform/start.sh` — subset of `run` without `DB_PATH` / light profile
- [x] **RS-0-08** Document `middleware-platform/startup.sh` as Azure-only (not local dev)
- [x] **RS-0-09** Remove leaked artifacts: `middleware-platform/:memory:*`, empty `node`/`sqlite3` files, `tmp-test-voice-tenant.db` at package root
- [x] **RS-0-10** Delete unused `middleware-platform/data/verify-trading.sqlite` and empty `data/somo.db` after confirm

### Phase 1 — Structural moves (RS-1)

- [x] **RS-1-01** Move `states_and_counties.csv` → `middleware-platform/data/geo/`; update `routes/public-geo.js`
- [x] **RS-1-02** Triage `data_national_county2020.txt` (archive, merge, or delete)
- [x] **RS-1-03** `var/db/` created; active DB under `var/db/middleware-dev.db`; legacy copies archived via `scripts/dev/run.sh`
- [x] **RS-1-04** CLIs moved to `middleware-platform/scripts/` with root stubs (`configure-retell.js`, `retell-diagnostic.js`, `verify-rapidapi-key.js`)
- [x] **RS-1-05** `docs/Database/ENV_AND_DB_SSOT.md` redirects to `OPERATIONS.md#env-and-db-ssot`
- [x] **RS-1-06** `scripts/README.md` documents root vs `middleware-platform/scripts/` boundary
- [x] **RS-1-07** Move `phase0-verify.cjs` → `scripts/phase0-verify.cjs`
- [x] **RS-1-08** `migrate-merchant-shop.js` uses `var/db/` + `MERCHANT_SHOP_DB_PATH` env override

### Phase 2 — Longer-term refactors (RS-2)

- [x] **RS-2-01** `database/connection.js` — path resolution, WAL, Postgres pool init (query helpers still in `database.js`)
- [ ] **RS-2-02** `deferred` — Move inline `migrate*()` batch to `database/migrations/startup/*.js`
- [ ] **RS-2-03** `deferred` — Move query helpers to `database/repositories/<domain>.js` per `ARCHITECTURE.md` Phase 2
- [ ] **RS-2-04** `deferred` — Split `server.js` per `docs/architecture/SERVER_DECOMPOSITION.md`
- [ ] **RS-2-05** `deferred` — Formalize `Knowledge/` boundary (`@somo/knowledge` workspace or `data/knowledge` symlink)
- [ ] **RS-2-06** `deferred` — Consolidate `middleware-platform/scripts/` into `payor/`, `verify/`, `seed/` subdirs
- [ ] **RS-2-07** `deferred` — Continue Postgres-primary path per `docs/Database/OPERATIONS.md` — reduce dual-write complexity

---

## P0 — Customer-ready prod gates

Full detail + file paths: [`docs/CUSTOMER_READY_BACKLOG.md`](../docs/CUSTOMER_READY_BACKLOG.md)

### P0-A Production enforcement

- [ ] **CR-001** `operator` — Run `verify:kelly-rails-cloudrun` on live `somo-middleware`; doc template in `docs/deployment/OPERATIONS.md`
- [ ] **CR-002** `operator` — Confirm `CONVERSATION_MODE_ROUTING=enforce` (not `shadow`) on prod Cloud Run
- [ ] **CR-003** `operator` — Enable `CONVERSATION_MODE_ENFORCE_TENANT_INBOUND_ADMIN=1` after 48h clean shadow telemetry
- [ ] **CR-004** `operator` — Confirm `KELLY_RAILS_V2=1`, `KELLY_RAILS_ROLLOUT_PCT=1`, `KELLY_ALLOW_HYBRID_GRAPH=0`
- [x] **CR-005** `verify:env-gates` + `verify:kelly-rails-cloudrun` fail deploy on shadow (`callsomo-terminal-cutover.sh deploy-api`)

### P0-B Hard transactional gates

- [x] **CR-007** Transactional tools stripped on `confirm_visit`, `pay_invoice`, `cancel_execute` (`tool-allowlists.js`)
- [x] **CR-008** Gate-owned reply only — payment/cancel gates require `r.reply`; `stripInventedTransactionalConfirmation` in `node-runner.js`
- [x] **CR-009** `booking-confirm-without-tool.test.js` — confirm without `schedule_appointment_success` does not return `booking_confirmed`

### P0-C Live verify scripts

- [x] **CR-010** `verify:live-booking-call` in `callsomo-terminal-cutover.sh` (set `SESSION_ID`+`DB_PATH`; `SKIP_LIVE_CALL_VERIFY=1` to skip)
- [x] **CR-011** `done` — `verify-live-copay-call.cjs` exists
- [x] **CR-012** `done` — `verify-live-cancel-call.cjs` exists
- [x] **CR-013** `done` — `verify-live-reschedule-call.cjs` exists
- [x] **CR-014** `done` — `verify-live-visit-checkout.cjs` exists

### P0-D Signup → live line

- [x] **CR-015** `saas-tenant-provision.test.js` — merchant + clinic + `prompt_profile` + `voice_agent_settings`
- [x] **CR-016** `docs/deployment/OPERATIONS.md#signup--live-line-cr-016` — Twilio + Retell assign path documented; self-serve `assign-line` + ops fallback
- [x] **CR-018** `visit_pricing` seeded in `provisionSaasTenant` per use case (`saas-tenant-provision.test.js`)
- [x] **CR-019** `ensureStripeMerchantReady` at provision (`saas-tenant-provision.js`); async fire-and-forget
- [x] **CR-020** `done` — `trial-activation.html` gates "Call my line" on `kelly/status` active + `has_phone` + `provisioning_state=ready`

### P0-E Telemetry truth

- [x] **CR-021** `done` — Score/TCR uses `tool_completed` from executor, not subrail `toolsUsed`
- [x] **CR-022** `verify-orchestration-trace-completeness.cjs` + `orchestration-telemetry-audit.js`; nightly workflow runs trace verify
- [x] **CR-023** `done` — Activity feed primary on `tool_completed` + `appointment_booked`

### P0 — Frontend

- [x] **FE-001** `done` — `data-testid` hooks on all 6 primary pages (patients.html has roster/search hooks)
- [x] **FE-013** `done` — Wire `provider-api.js` on agent, calendar, revenue, patients, today, calls

### P1 — Core flows

- [x] **CR-024** `ensureUniqueTriageSessionId` + migration `060_triage_session_id_unique.js` + unique index
- [ ] **CR-025** `operator` — Run `npm run sandbox:spanish-green` 3× consecutive 14/14 TCR on staging
- [x] **CR-026** `policy_json` + `use_case` on `prompt_profiles` (`059_prompt_profiles_policy_json.js`, `saas-tenant-provision.js`)
- [x] **CR-027** Provider availability admission gate — `no_provider_availability` + `slots_empty` reply (`booking-no-availability-gate.test.js`)
- [x] **CR-028** `auto-checkout-after-schedule.js` — SaaS defaults on unless `AUTO_CHECKOUT_AFTER_SCHEDULE=0`
- [ ] **CR-029** `operator` — Live prod booking acceptance — runbook in `docs/deployment/OPERATIONS.md`
- [ ] **CR-030** `operator` — Prod live cancel → `verify:live-cancel-call` PASS
- [ ] **CR-031** `operator` — Prod live reschedule → `verify:live-reschedule-call` PASS
- [ ] **CR-032** `operator` — Same-day cancel + rebook prod smoke (`verify:same-day-cancel-rebook`)
- [x] **CR-033** Cancellation subrail emits `cancel_intents` (`cancellation-subrail-intents.test.js`)
- [x] **CR-034** `seedModeAtCallStart` for `tenant_billing` copay (`billing-mode-entry.test.js`)
- [x] **CR-035** Sticky `preferred_language` on payment gate (`resolve-locale.js` + `payment.js`)
- [ ] **CR-036** `operator` — Prod live copay → `verify:live-copay-call`
- [ ] **CR-037** `operator` — Prod book → checkout → pay on `patients/pay.html` (runbook in OPERATIONS.md)
- [x] **CR-039** `done` — `hydrateSessionForTurn(sessionId)` merge projection + meta_kv + triage
- [x] **CR-040** `done` — OPQRST → booking pivot syncs `triage_sessions` into projection
- [x] **CR-041** Turn-planner uses subrail `cancel_intents` / `booking_intents` in enforce path (`lane-handoff-mapper.js`)
- [x] **CR-042** Telemetry SLO documented — `docs/deployment/OPERATIONS.md#telemetry-slo-cr-042`
- [x] **CR-043** `done` — Call detail forensics in portal (`pp-page-shell`, orchestration trace, call summary)
- [x] **CR-044** `done` — Activity feed: cancel + reschedule + payment events consistently
- [x] **CR-045** `done` — Calendar reflects voice-booked appts within 30s (`ppStartAppointmentPoll`)
- [x] **CR-046** `done` — Revenue tab: `voice_checkouts` + RCM payments scoped to clinic
- [ ] **CR-047** `operator` — `test:prod:provider-portal` — run with prod credentials
- [x] **FE-008** `patient-case.html` provider shell + `?patient_id=` auto-load
- [x] **FE-010** `done` — "Booked by Kelly" badge on Today + calendar board/list
- [x] **FE-019** Prod Playwright smoke — `provider-portal-journey-prod.spec.cjs` (login + Today + Kelly panel)

### P2 — Scale

- [x] **CR-048** Signup `medical_specialty` → `resolveSpecialtyToUseCase` → `prompt_profile` + `visit_pricing` (`specialty-use-case-map.test.js`)
- [x] **CR-049** Self-serve `POST /api/signup/assign-line` + E2E (`staging-signup-api-trial.spec.cjs`)
- [ ] **CR-050** `partial` — Google Calendar sync double-book prevention E2E
- [x] **CR-051** `verify-call-opener-parity.cjs` — prod spot-check operator
- [x] **CR-052** `SAAS_VOICE_FAIL_CLOSED` documented in OPERATIONS.md
- [x] **CR-053** `prompt-bounding-locale.js` — merged subrail objectives + locale lock (`prompt-bounding-locale.test.js`)
- [x] **CR-054** Post-payment deterministic EN/ES/ZH (`post_payment_confirmed` in `deterministic.js`)
- [x] **CR-055** `verify:asr-low-confidence` script referenced in OPERATIONS.md
- [x] **CR-056** OPQRST → book sandbox in CI (`test:kelly:rails:golden`); prod runbook operator
- [x] **CR-057** `verify:emergency-rail` script in OPERATIONS.md live verify table
- [x] **CR-058** `verify-live-records-call.cjs` exists
- [x] **CR-060** `call_opener_used` emitted in `voice-incoming-handler.js` + `retell-websocket.js`
- [ ] **CR-059** `operator` — Operator outbound stable TCR + prod test call runbook
- [x] **CR-061** `verify-env-gates` wired in `.github/workflows/ci.yml`
- [x] **CR-062** Nightly `.github/workflows/kelly-rails-prod-nightly.yml`
- [x] **CR-063** `verify:gcs-sqlite-contention` in nightly workflow + OPERATIONS.md
- [x] **CR-064** `done` — Post-call owner email (booked / cancelled / payment link)
- [ ] **CR-065** `partial` — Rollback runbook tested (<15 min)
- [ ] **FE-016** `open` — Split `settings.html` into tab modules
- [x] **FE-017** Patient notes composer on `patient-case.html` + `PATCH /api/provider/appointments/:id/notes`
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

**OPQRST Field Gate (engineering):** [`todos/OPQRST-FIELD-GATE.md`](OPQRST-FIELD-GATE.md) — **F-2 shipped** (rev `00076-6sr`, gate on). Sign-off: [`docs/clinical/OPQRST_FIELD_GATE_SHIP_SIGNOFF_2026-06-18.md`](../docs/clinical/OPQRST_FIELD_GATE_SHIP_SIGNOFF_2026-06-18.md). ES pack and live Retell scorecards still apply below.

- [x] **C-P0-04-en-auto** EN automated cohort (10/10 gate scenarios) — `npm run smoke:opqrst-phase-c-en --prefix middleware-platform`
- [ ] **C-P0-01** Complete OPQRST review packet; Spanish copy for `config/clinical-opqrst/es.json`
- [ ] **C-P0-02** Add `docs/clinical/OPQRST_ES_SIGNOFF_<date>.md`
- [ ] **C-P0-03** Populate `es.json` from approved text (no auto-translate in prod)
- [ ] **C-P0-04** EN cohort: 10 happy-path calls per scorecard _(automated 10/10 done; optional live Retell perceptual)_
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
- [x] **P1** JWT FHIR guard (`REQUIRE_JWT_FOR_FHIR` in `server.js`) + issuer routes (`auth-tokens.js`)
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
- [x] **Today UI** Empty-state CTAs on calls/messages panels (`ppPanelState` + `today.html`)
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
| **P0** | Demo Phase 1 conversion | **0** (complete) |
| **P0** | Codebase & DB structure (RS-0, RS-1) | **0** (complete) |
| **P0** | RS-2 refactors | **6** (deferred) |
| **P0** | Customer-ready CR/FE (engineering) | **~12** operator + **~5** deferred |
| **P1** | Demo operator sign-off | **3** (operator) |
| **P1** | Kelly Phase C sign-off | **~24** (clinical/operator) |
| **P2** | RCM, telemedicine, payor, GCP, photo-to-bill, UI polish | **~40** (deferred) |
| **P3** | Commerce checkout, LangGraph, derm Q&A, legacy funnel | deferred |
