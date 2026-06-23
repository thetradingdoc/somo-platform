# Customer-Ready Backlog — Full Todo List (85 items)

**Last updated:** 2026-06-18  
**Canonical open-work SSOT:** [`todos/PENDING.md`](../todos/PENDING.md) and [`todos/VOICE-REMEDIATION-TRAIN.md`](../todos/VOICE-REMEDIATION-TRAIN.md).  
**Implementation status:** P0–P2 engineering code largely complete. Prod live-call proofs are operator-run (`verify:live-*` scripts). See [`docs/deployment/OPERATIONS.md`](deployment/OPERATIONS.md).

**Status legend:** `done` | `partial` | `open` | `runbook` (script exists; prod execution documented separately) | `operator` (human gate)

**Prod live calls:** Scripts + runbooks only; you run live calls separately.

---

## Exit criteria (9 proof gates — not separate implementation todos)

| # | Criterion | Closes | Proof |
|---|-----------|--------|-------|
| 1 | Signup → live number | CR-015–020 | `trial-provision-smoke.cjs` |
| 2 | English inbound book | CR-010, CR-029 | `npm run verify:live-booking-call` |
| 3 | Inbound copay link | CR-011, CR-036 | `npm run verify:live-copay-call` |
| 4 | Cancel + reschedule | CR-012–013, CR-030–031 | `verify:live-cancel-call` / `verify:live-reschedule-call` |
| 5 | Post-book checkout | CR-014, CR-037 | `npm run verify:live-visit-checkout` |
| 6 | Dashboard without SQL | CR-043–047, FE-003–004 | `npm run test:e2e:provider-journey` |
| 7 | Enforce routing on prod | CR-001–005 | `npm run verify:kelly-rails-cloudrun` |
| 8 | No confirm without DB row | CR-006–009 | unit tests |
| 9 | 48h pilot clean telemetry | CR-042 | forensics SQL |

---

## P0 — Blockers (23 CR + 8 FE partial)

### P0-A Production enforcement

- [ ] **CR-001** `partial` — Run `verify:kelly-rails-cloudrun` on live `somo-middleware`; document revision + env in [`docs/deployment/OPERATIONS.md`](docs/deployment/OPERATIONS.md) | Proof: `npm run verify:kelly-rails-cloudrun`
- [ ] **CR-002** `partial` — Confirm `CONVERSATION_MODE_ROUTING=enforce` (not `shadow`) on prod Cloud Run | Proof: cloudrun env script
- [ ] **CR-003** `open` — Enable `CONVERSATION_MODE_ENFORCE_TENANT_INBOUND_ADMIN=1` after 48h clean shadow telemetry | Files: [`generate-cloudrun-env-yaml.cjs`](middleware-platform/scripts/generate-cloudrun-env-yaml.cjs)
- [ ] **CR-004** `partial` — Confirm `KELLY_RAILS_V2=1`, `KELLY_RAILS_ROLLOUT_PCT=1`, `KELLY_ALLOW_HYBRID_GRAPH=0` | Proof: `verify-kelly-rails-cloudrun-env.cjs`
- [ ] **CR-005** `partial` — Wire cloudrun verify into post-deploy; fail deploy on shadow | Files: [`callsomo-terminal-cutover.sh`](middleware-platform/scripts/callsomo-terminal-cutover.sh)

### P0-B Hard transactional gates

- [ ] **CR-006** `done` — No "appointment confirmed" unless `schedule_appointment_success` or DB row | Files: [`gates/schedule.js`](middleware-platform/services/kelly/rails/gates/schedule.js), [`appointment-read.js`](middleware-platform/services/kelly/rails/appointment-read.js)
- [ ] **CR-007** `partial` — Remove transactional tools from LLM allowlist on `confirm_visit`, `cancel_execute`, `pay_invoice` | Files: [`tool-allowlists.js`](middleware-platform/services/kelly/rails/tool-allowlists.js), [`gate-registry.js`](middleware-platform/services/kelly/rails/gate-registry.js)
- [ ] **CR-008** `partial` — Gate-owned reply only; LLM must not invent confirmation when gate returns `reply` | Files: [`node-runner.js`](middleware-platform/services/kelly/rails/node-runner.js)
- [ ] **CR-009** `open` — Unit test: confirm utterance without `tool_completed` → no `booking_confirmed` key | Files: `__tests__/booking-confirm-without-tool.test.js` (new)

### P0-C Live verify scripts

- [ ] **CR-010** `partial` — `verify:live-booking-call` mandatory after voice deploy | Files: [`verify-live-booking-call.cjs`](middleware-platform/scripts/verify-live-booking-call.cjs) | Proof: `npm run verify:live-booking-call`
- [ ] **CR-011** `open` — Create `verify-live-copay-call.cjs` (`tool_completed` + `payment_link_sent`) | Proof: `npm run verify:live-copay-call`
- [ ] **CR-012** `open` — Create `verify-live-cancel-call.cjs` (`cancel_appointment` + `status=cancelled`) | Proof: `npm run verify:live-cancel-call`
- [ ] **CR-013** `open` — Create `verify-live-reschedule-call.cjs` (new date/time in DB) | Proof: `npm run verify:live-reschedule-call`
- [ ] **CR-014** `open` — Create `verify-live-visit-checkout.cjs` (`voice_checkouts` + `visit_pricing` amount) | Proof: `npm run verify:live-visit-checkout`

### P0-D Signup → live line

- [ ] **CR-015** `partial` — Automated test: `provisionSaasTenant` creates merchant + clinic + `prompt_profile` + `voice_agent_settings` | Files: [`saas-tenant-provision.js`](middleware-platform/services/saas-tenant-provision.js), [`trial-provision-smoke.cjs`](middleware-platform/scripts/trial-provision-smoke.cjs)
- [ ] **CR-016** `partial` — Twilio number + Retell agent assign path (auto or documented ops) | Files: [`signup-trial.js`](middleware-platform/routes/signup-trial.js), OPERATIONS.md
- [ ] **CR-017** `done` — Retell vars `customer_id`, `clinic_id`, `call_type=tenant` | Proof: `npm run verify:voice-identity-vars` (script: [`verify-voice-identity-vars.cjs`](middleware-platform/scripts/verify-voice-identity-vars.cjs))
- [ ] **CR-018** `open` — Seed `visit_pricing` in `provisionSaasTenant` per use case/specialty | Files: [`saas-tenant-provision.js`](middleware-platform/services/saas-tenant-provision.js)
- [ ] **CR-019** `partial` — Stripe merchant ready at provision, not lazy on first checkout | Files: provision + Stripe ensure
- [ ] **CR-020** `partial` — `trial-activation.html` gates "Call my line" on `kelly/status` ready + real number | Files: [`trial-activation.html`](unified-dashboard/business/trial-activation.html)

### P0-E Telemetry truth

- [ ] **CR-021** `partial` — Score/TCR uses `tool_completed` from executor, not subrail `toolsUsed` | Files: [`kelly-tool-executor.js`](middleware-platform/services/kelly-tool-executor.js)
- [ ] **CR-022** `partial` — `orchestration_trace` completeness audit (`gate_matched`, `gate_outcome`, `lane`, `step`) | Files: [`verify-p0-telemetry.cjs`](middleware-platform/scripts/verify-p0-telemetry.cjs) or new script
- [ ] **CR-023** `partial` — Activity feed primary on `tool_completed` + `appointment_booked`, not `turn_resolved.tools_used` | Files: [`kelly-activity-feed-service.js`](middleware-platform/services/kelly-activity-feed-service.js)

### P0 — Frontend (finish partials)

- [ ] **FE-001** `partial` — `data-testid` hooks on all 6 primary pages (add [`patients.html`](unified-dashboard/business/patients.html))
- [ ] **FE-002** `done` — Calendar in-modal cancel/reschedule (no `prompt`/`reload`) | [`calendar.html`](unified-dashboard/business/calendar.html)
- [ ] **FE-005** `done` — Trial activation provision failure + retry CTA | [`trial-activation.html`](unified-dashboard/business/trial-activation.html)
- [ ] **FE-006** `done` — Playwright provider journey suite | [`e2e/provider/`](middleware-platform/e2e/provider/)
- [ ] **FE-007** `done` — Real UI login in E2E | [`portal-auth.cjs`](middleware-platform/e2e/provider/helpers/portal-auth.cjs)
- [ ] **FE-013** `partial` — Wire [`provider-api.js`](unified-dashboard/assets/js/provider-api.js) on agent, calendar, revenue, patients (only today + calls today)
- [ ] **FE-014** `done` — `billing.html` redirect stub | [`billing.html`](unified-dashboard/business/billing.html)
- [ ] **FE-015** `done` — Clinical prep empty/error copy | `today.html`, `calendar.html`

**P0 exit:** 31 items → all `done` or `runbook`; `npm run test:e2e:provider-journey` green.

---

## P1 — Core flows prod-green (24 CR + 7 FE)

### P1-A Booking

- [ ] **CR-024** `open` — Fix Spanish booking prod flake (`triage_session_id` uniqueness + GCS SQLite contention)
- [ ] **CR-025** `open` — `sandbox-spanish-green`: 3× consecutive 14/14 TCR
- [x] **CR-026** `done` — `policy_json` + `use_case` on `prompt_profiles` at provision; backfill existing clinics → R-12-2
- [x] **CR-027** `done` — Schedule gate `no_provider_availability`; lane-entry redirect → R-12-1
- [ ] **CR-028** `open` — `auto-checkout-after-schedule` default on for SaaS tenants | [`auto-checkout-after-schedule.js`](middleware-platform/services/auto-checkout-after-schedule.js)
- [ ] **CR-029** `runbook` — Live prod booking acceptance documented in OPERATIONS.md | Proof: `verify:live-booking-call`

### P1-B Cancel / reschedule (voice)

- [ ] **CR-030** `runbook` — Prod live cancel → `verify:live-cancel-call` PASS (runbook)
- [ ] **CR-031** `runbook` — Prod live reschedule → `verify:live-reschedule-call` PASS (runbook)
- [ ] **CR-032** `open` — Same-day cancel + rebook prod smoke
- [ ] **CR-033** `partial` — Cancellation subrail intents only; no phantom `toolsUsed` | [`cancellation-subrail.js`](middleware-platform/services/conversation/subrails/cancellation-subrail.js)

### P1-C Payments

- [ ] **CR-034** `partial` — `seedModeAtCallStart` for `tenant_billing` on copay first utterance
- [ ] **CR-035** `open` — Sticky `preferred_language` on payment gate replies | [`voice-reply-formatter.js`](middleware-platform/services/voice-reply-formatter.js)
- [ ] **CR-036** `runbook` — Prod live copay → `verify:live-copay-call` (runbook)
- [ ] **CR-037** `runbook` — Prod book → checkout → pay on `patients/pay.html` (runbook)
- [ ] **CR-038** `done` — Provider portal "Test payment link" on agent | [`agent.html`](unified-dashboard/business/agent.html) (`agent-test-payment`)

### P1-D Conversation + SSOT

- [ ] **CR-039** `open` — `hydrateSessionForTurn(sessionId)` merge projection + meta_kv + triage | [`hydrate.js`](middleware-platform/services/kelly/rails/hydrate.js), [`execute-turn.js`](middleware-platform/services/kelly/rails/execute-turn.js)
- [ ] **CR-040** `open` — OPQRST → booking pivot syncs `triage_sessions` into projection
- [ ] **CR-041** `partial` — Turn-planner audit: cancel/records/copay intents from subrails only | [`turn-planner.js`](middleware-platform/services/kelly/rails/turn-planner.js)
- [ ] **CR-042** `open` — Telemetry SLO: `orchestration_trace_gap` < 1% documented in OPERATIONS.md

### P1-E Dashboard proof

- [ ] **CR-043** `partial` — Call detail forensics in portal (calls page shipped; Today links out) | [`calls.html`](unified-dashboard/business/calls.html), [`routes/kelly.js`](middleware-platform/routes/kelly.js)
- [ ] **CR-044** `partial` — Activity feed: cancel + reschedule + payment events consistently | [`kelly-activity-feed-service.js`](middleware-platform/services/kelly-activity-feed-service.js)
- [ ] **CR-045** `open` — Calendar reflects voice-booked appts within 30s (poll in [`provider-shell.js`](unified-dashboard/assets/js/provider-shell.js))
- [ ] **CR-046** `open` — Revenue tab: `voice_checkouts` + RCM payments scoped to clinic | [`tab-payments.js`](unified-dashboard/assets/js/revenue/tab-payments.js)
- [ ] **CR-047** `partial` — Provider portal post-login smoke via verify scripts | `npm run verify:tenant-site-context`

### P1 — Frontend

- [ ] **FE-003** `done` — Calls page + Today "View all" | [`calls.html`](unified-dashboard/business/calls.html)
- [ ] **FE-004** `done` — Call detail + `GET /api/kelly/calls/:sessionId` | [`routes/kelly.js`](middleware-platform/routes/kelly.js)
- [ ] **FE-008** `partial` — `patient-case.html` provider shell + `?patient_id=` auto-load
- [ ] **FE-009** `done` — Kelly activity deep-links to calls/calendar | [`kelly-activity-feed-service.js`](middleware-platform/services/kelly-activity-feed-service.js)
- [ ] **FE-010** `partial` — "Booked by Kelly" badge (Today done; calendar rows open)
- [ ] **FE-011** `done` — Today onboarding checklist | [`today.html`](unified-dashboard/business/today.html)
- [ ] **FE-012** `done` — Agent test payment button (same as CR-038)
- [ ] **FE-019** `partial` — Expand prod Playwright smoke (login + Today; needs post-login Kelly check)

**P1 exit:** 31 items → all `done` or `runbook`.

---

## P2 — Scale (18 CR + 5 FE)

### P2-A Onboarding / multi-tenant

- [ ] **CR-048** `partial` — Signup specialty/use case → `prompt_profile` template + `visit_pricing` seed
- [ ] **CR-049** `partial` — Self-serve Twilio assign-line in signup flow
- [ ] **CR-050** `partial` — Google Calendar sync double-book prevention E2E | [`settings.html`](unified-dashboard/business/settings.html)
- [ ] **CR-051** `open` — `verify-call-opener-parity.cjs` — settings greeting matches live opener | [`call-opener-resolver.js`](middleware-platform/services/call-opener-resolver.js)
- [ ] **CR-052** `partial` — `SAAS_VOICE_FAIL_CLOSED=1` prod verify + runbook | [`voice-incoming-handler.js`](middleware-platform/services/voice-incoming-handler.js)

### P2-B Language / quality

- [ ] **CR-053** `open` — `prompt-bounding-locale` — merged subrail objectives + locale lock
- [ ] **CR-054** `partial` — All deterministic gate strings EN/ES/ZH | [`deterministic.js`](middleware-platform/services/kelly/rails/prompts/deterministic.js)
- [ ] **CR-055** `open` — ASR low-confidence → clarify prod monitor script

### P2-C Clinical chain

- [ ] **CR-056** `partial` — OPQRST → book sandbox chain + prod runbook
- [ ] **CR-057** `partial` — Emergency rail prod spot-check (911, no booking pivot) | [`gates/safety.js`](middleware-platform/services/kelly/rails/gates/safety.js)
- [ ] **CR-058** `open` — `verify-live-records-call.cjs`

### P2-D Outbound

- [ ] **CR-059** `partial` — Operator outbound stable TCR + prod test call runbook
- [ ] **CR-060** `partial` — Outbound opener → `call_opener_used` in `kelly_call_events`

### P2-E Ops / reliability

- [ ] **CR-061** `open` — `verify-env-gates.cjs` in CI (fail prod profile with `shadow`)
- [ ] **CR-062** `partial` — Nightly `verify:kelly-rails-prod-runtime` workflow
- [ ] **CR-063** `open` — GCS SQLite contention monitor + alert doc
- [ ] **CR-064** `open` — Post-call owner email (booked / cancelled / payment link) | [`kelly-call-telemetry.js`](middleware-platform/services/kelly-call-telemetry.js)
- [ ] **CR-065** `partial` — Rollback runbook tested (<15 min) | [`docs/runbooks/CONVERSATION_MODE_ROLLOUT.md`](docs/runbooks/CONVERSATION_MODE_ROLLOUT.md)

### P2 — Frontend polish

- [ ] **FE-016** `open` — Split [`settings.html`](unified-dashboard/business/settings.html) (~1782 lines) into tab modules
- [ ] **FE-017** `open` — Patient notes composer UI + wire `PATCH` notes API | [`provider-case-summary-route.js`](middleware-platform/routes/provider-case-summary-route.js)
- [ ] **FE-018** `open` — Mobile responsive pass (calendar + revenue)
- [ ] **FE-020** `open` — Remove 15 redirect stub HTML after Firebase rewrite rules | [`legacy-provider-redirect.js`](unified-dashboard/assets/js/legacy-provider-redirect.js)

**P2 exit:** 23 items → all `done` or `runbook`.

---

## P3 — Deferred (7 CR — out of P0–P2 scope)

- [ ] **CR-066** `open` — SSOT Postgres-primary when `KELLY_RAILS_SSOT_POSTGRES=1`
- [ ] **CR-067** `open` — Live Kelly turn stream on provider shell
- [ ] **CR-068** `open` — Video visit SMS after booking
- [ ] **CR-069** `open` — EHR sync optional for v1 pilot
- [ ] **CR-070** `open` — Admin CRM separate from clinic portal
- [ ] **CR-071** `open` — Analytics dashboard deferred
- [ ] **CR-072** `open` — General pay-any-invoice voice path deferred

---

## Summary counts

| Bucket | Total | Done | Partial | Open/Runbook |
|--------|------:|-----:|--------:|-------------:|
| P0 CR (001–023) | 23 | 2 | 15 | 6 |
| P0 FE (001–015 subset) | 8 | 5 | 3 | 0 |
| P1 CR (024–047) | 24 | 1 | 8 | 15 |
| P1 FE (003–012, 019) | 7 | 4 | 3 | 0 |
| P2 CR (048–065) | 18 | 0 | 10 | 8 |
| P2 FE (016–020) | 5 | 0 | 0 | 5 |
| **P0–P2 total** | **85** | **12** | **39** | **34** |
| P3 CR (066–072) | 7 | 0 | 0 | 7 |

---

## Implementation order (unchanged)

1. **P0** — CR-001→005, 006→009, 010→014, 015→020, 021→023, FE-001/013
2. **P1** — CR-024→047, FE-008/010/019
3. **P2** — CR-048→065, FE-016→020
4. Update [`docs/CUSTOMER_READY_BACKLOG.md`](docs/CUSTOMER_READY_BACKLOG.md) (mirror this list) + OPERATIONS.md + gap matrix after each phase

---

## What changes in the plan file

Replace the 7 umbrella YAML todos with **85 line-item todos** (one per CR/FE above) in frontmatter, plus keep 2 meta items:

- `meta-backlog-sync` — Mirror checklist to `docs/CUSTOMER_READY_BACKLOG.md`
- `meta-docs-exit` — Update OPERATIONS.md + gap matrix + exit criteria after each phase
