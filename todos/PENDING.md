# Somo — all pending work

**Last updated:** 2026-07-11  
**Engineering status SSOT:** This file is the **sole** entry point for open engineering work.

## Kelly Master Plan — open inventory (honest, 2026-07-11)

**SSOT:** [`KELLY_CODING_MASTER_EXECUTION_PLAN.md`](../docs/Medical%20Coding/KELLY_CODING_MASTER_EXECUTION_PLAN.md)

| Bucket | Open count | IDs / location |
|--------|------------|----------------|
| P0 operator closeout | **2** | CF-OP-5 (F-09 clinical) · CF-OP-8 (name clinical lead) |
| Appendix B (K-02) | **1** | **3/7** nights — nights 4–7 remain |
| Appendix C (F-09) | **7** | C-P0-01..C-P0-07 clinical signatures *(blocked on CF-OP-8)* |
| Phase 4 closeout bookkeeping | **1** | D-01/K-02/F-09 → `done` in CODING-FOUNDATION *(blocked on K-02 + F-09)* |
| Optional follow-ups | **2** | DP-02 Secret Manager migration; MT-09 live PSTN evidence |
| **Kelly plan total open** | **13** | **Blockers only** — all eng + automatable operator work complete |

**Gates:** G0 eng prereqs met (D-01 evidence + spine on prod); **G0–G5 fully closed** blocked on K-02 (5 nights) + F-09 clinical sign-off.

## P0 — CODING-FOUNDATION closeout (operator)

**SSOT:** [`todos/CODING-FOUNDATION.md`](./CODING-FOUNDATION.md) · [`docs/Medical Coding/KELLY_CODING_MASTER_EXECUTION_PLAN.md`](../docs/Medical%20Coding/KELLY_CODING_MASTER_EXECUTION_PLAN.md) · [`docs/Medical Coding/OPERATIONS.md`](../docs/Medical%20Coding/OPERATIONS.md)

Eng tracks A–N complete on dev. **Operator closeout pending:**

- [x] **CF-OP-1** Staging + prod import chain (B-01–B-04) → `verify:prod-codebook` → GCS upload *(prod GCS verified 2026-07-10)*
- [x] **CF-OP-2** Embeddings `--until-done` + specialty backfill (C-01, C-02, C-03) — 110,017 on prod GCS
- [x] **CF-OP-3** Pinecone env + K-06 staging spine (`verify-live-spine`, `verify-triage-spine`) — green 2026-07-10
- [x] **CF-OP-4** K-02 nightly workflow wired (`ci-coding-db-fixture` + secrets); K-05 evidence script in deploy checklist
- [ ] **CF-OP-5** F-09 — Eng attestation ready: [`F09_ENG_ATTESTATION.md`](../docs/Medical%20Coding/F09_ENG_ATTESTATION.md); **clinical C-P0 signatures pending** *(blocked: CF-OP-8)*
- [x] **CF-OP-6** D-01 — *(**eng complete** 2026-07-11)* A1–A11 + `capture:coding-prod-evidence` SUMMARY success; prod spine on `middleware-prod.db`; evidence at `gs://somo-staging-db-somo-callsomo/evidence/coding-prod/`
- [ ] **CF-OP-7** K-02 — **3/7** consecutive green nights logged *(2026-07-11, 64% fast eval after eng sweep)* — [`k02-nightly-log.json`](../middleware-platform/var/evidence/k02-nightly-log.json) — **4 nights remain**
- [ ] **CF-OP-8** Gov-06 — Clinical lead registry: [`KELLY_F09_GOVERNANCE.md`](../docs/clinical/KELLY_F09_GOVERNANCE.md) *(accountable: Jay; **name clinical lead** — product blocker)*
- [x] **CF-OP-9** Evid-01 — Durable evidence uploaded 2026-07-11 — `gs://somo-staging-db-somo-callsomo/evidence/coding-prod/` (22 files); local `SUMMARY.json` success

**ID audit (2026-07-10):** CF-OP-5 was F-09 only in earlier drafts; CF-OP-6/7 added for D-01/K-02 — no duplicate IDs.

**Honesty fixes (eng):** B-05 partial (hot-code CDT descriptions + tier-2 quality flag; licensed ADA deferred), L-03 done, M-02 CDT-aware simulate tested. **2026-07-11 eng sweep:** lay-language phrase map, preventive eval admin path, dental ortho_consult D9310, Jest codebook seed, `skip_fast_eval` filler hygiene, TENANT_MATRIX eng complete.

## P0.5 — Copay product gaps (post-epic)

**Out of CODING-FOUNDATION IDs.** Stedi 271 at scale remains out of scope.

- [x] **C-DF** Honest deferral SSOT (`coding-deferral-copy.json`) + PSTN scenario DENTAL-015 + `dental-deferral-copy.test.js`
- [x] **C-BR** `plan_rules` benefit ingest schema + `import-plan-rules-benefits.cjs` + sample (3 payers)
- [x] **C-PR** Medical vs dental payer routing (`payer-class-routing.js`, collect + quote path, tests)
- [x] **C-PL** Provider/location copay — **defer Phase 1** (`resolve-amount-due`, `journey-gates-service`, OPERATIONS.md)

## P0 — CODING-FOUNDATION epic (archived — eng complete)

**SSOT:** [`todos/CODING-FOUNDATION.md`](./CODING-FOUNDATION.md) · [`docs/Medical Coding/CODING_PATH_MATRIX.md`](../docs/Medical%20Coding/CODING_PATH_MATRIX.md)

Medical + dental coding layer: ICD/CPT/HCPCS/CDT codebooks, embeddings, Pinecone (medical), phrase maps, triage spine, resolver validation, eval/CI gates.

- [x] **CF-A** Tenant routing + `resolve-visit-codes.js` (Tracks A, M handoff)
- [x] **CF-B** Codebook parity gates + CDT import (**7.7-EXT** → B-05 partial)
- [x] **CF-C/D** Embeddings scripts, dual-source migration, Pinecone deploy gates (operator run pending)
- [x] **CF-F/G** Triage ranking, HCPCS, NCCI pair validation
- [x] **CF-H/I** Dental spine + admin medical phrase map
- [x] **CF-K/N** Eval profiles, governance docs, outage runbook

**Out of epic:** dollar precedence (M-01 done); `plan_rules` ingest → **P0.5 C-BR**; Stedi **6.10**.  
**Production execution:** [`docs/plans/CURSOR_PRODUCTION_PLAN.md`](../docs/plans/CURSOR_PRODUCTION_PLAN.md) · audit [`PRODUCTION_PLAN_LOG.md`](../PRODUCTION_PLAN_LOG.md)  
**CR/FE detail archive:** [`docs/CUSTOMER_READY_BACKLOG.md`](../docs/CUSTOMER_READY_BACKLOG.md) (historical ticket IDs only — do not update status here)

## Production plan closure — pending ([`CURSOR_PRODUCTION_PLAN`](../docs/plans/CURSOR_PRODUCTION_PLAN.md))

**Status:** Phases 0–5, 11–12 code-complete · **All automatable gates green** (`npm run operator:plan-closure` — **10/10** local, 2026-07-06) · **14 operator/legal items** remain · Phase 9 + 5.17 deferred.

**Local closure runner:** `cd middleware-platform && npm run operator:plan-closure` → `test-results/operator-plan-closure.json`  
**Audit middleware:** `npm run dev:audit` then `TENANT_AUDIT_FORCE_RESTART=1 TENANT_AUDIT_STRICT=1 npm run test:e2e:tenant-audit:strict`

### Close-all-non-blockers code closure (2026-07-06)

Source: production code review inventory (excludes Stedi 6.10 + Dentrix live API only).

- [x] **F1** — `reset-password.html` uses `window.API_BASE || window.location.origin`
- [x] **D5** — `seed-demo-accounts.js` `customer_clinics` INSERT (no `updated_at`)
- [x] **F2** — `createFHIRPatient` bare `resource_id`; audit seed + `seedPatient` lookup fix
- [x] **F3/S2** — `case-report.js` merchant deny when missing/mismatch + Jest (`case-report-merchant-scope.test.js`)
- [x] **G4/5.19** — `/patients/*` → `/signup`; `portal.html` provider-only; `patient-portal-retirement.test.js`
- [x] **F5/F6/UX1** — `ppFetchAppointmentsToday` throws; appointment helpers use `ppFetch` + `getAuthHeaders`; Today error UX
- [x] **F4/S3** — `tenant-integrations` route comment + `tenant-integrations-clinic-scope.test.js`
- [x] **D1/D2** — `ci-local.sh` strict tenant audit; `npm run dev:audit`
- [x] **FE3–FE5** — Audit: `a.portal-choice`, calendar view-tab anchors, revenue journey seed
- [x] **AI2–AI5** — `+1555` E.164 test numbers simulate SMS (no Twilio stderr); `KELLY_DEBUG_VERBOSE`; default `LOCAL_DEV_ROOT=signup`
- [x] **G2/12.3 eng** — [`docs/compliance/RETENTION_COUNSEL_REVIEW.md`](../docs/compliance/RETENTION_COUNSEL_REVIEW.md); BAA tracker evidence columns
- [x] **P5-AUDIT-08** — Strict audit: **157 pass / 0 fail / 21 skip** ([`tenant-front-desk-audit.md`](../middleware-platform/test-results/tenant-front-desk-audit.md))
- [x] **ACC-13** — Multilang strict **19/19** (`VOICE_EVAL_SIMULATE_SMS=1`)
- [x] **ACC-16** — Patient portal retired (G4)

### P0 — Code fixes (blocks Phase 5 + acceptance 17)

Source: [`tenant-front-desk-audit.md`](../middleware-platform/test-results/tenant-front-desk-audit.md) (157 pass / 0 fail / 21 skip, 2026-07-06 strict).

- [x] **P5-AUDIT-01** — `calendar.html`: `refresh` hoisted to outer scope (List/Week/Month)
- [x] **P5-AUDIT-02** — `today.html` appointment tabs: `ppFetchAppointmentsToday` soft-fail via `ppFetch`
- [x] **P5-AUDIT-03** — Kelly toggle: re-login per audit page + session cookie sync
- [x] **P5-AUDIT-04** — Settings Connected Accounts: `requireCustomerAuth` + anchor probe
- [x] **P5-AUDIT-05** — payor-review / merge-review: `platform.leads` caps seeded
- [x] **P5-AUDIT-06** — `video-call.html` provider shell nav fixed
- [x] **P5-AUDIT-07** — signup / reset-password / portal auth-shell parity
- [x] **P5-AUDIT-08** — Strict audit green: `TENANT_AUDIT_STRICT=1 PW_API_BASE_URL=http://127.0.0.1:4001 npm run test:e2e:tenant-audit:strict`
- [x] **P5-AUDIT-09** — `tenant-front-desk-audit:safe` wired in `scripts/ci-local.sh`

### P0 — Automatable local gates (closed 2026-07-06)

- [x] **7.8-local** — `npm run phase7:release-smoke` — pass
- [x] **7.9-local** — `npm run verify:phase7-deploy-gate` (no `LIVE=1`) — pass
- [x] **7.6-dry** — `npm run rollback:drill` — pass (&lt;15 min budget)
- [x] **7.1-local** — `verify-postgres-gcs-reconciliation.cjs` sqlite mode — pass
- [x] **7.2-local** — `verify-postgres-mirror-lag.cjs` (POSTGRES_URL unset skip) — pass
- [x] **7.10-structural** — `verify-tenant-provisioning.cjs --structural` — 4 verticals
- [x] **LOG-01** — Phase 1 (1.1–1.13) entries in `PRODUCTION_PLAN_LOG.md`

### P0 — Gate / compliance (not blocking code merge)

- [ ] **G2** `operator` — Counsel sign-off on [`docs/compliance/RETENTION_COUNSEL_REVIEW.md`](../docs/compliance/RETENTION_COUNSEL_REVIEW.md) (engineering export ready; dry-run attached in log)
- [ ] **12.3-OPS** `operator` — Legal signature rows in [`docs/compliance/VENDOR_BAA_TRACKER.md`](../docs/compliance/VENDOR_BAA_TRACKER.md) (engineering evidence columns complete)

### P0 — Blocked on credentials

- [ ] **6.10** `blocked` — Stedi 271 multilingual live sign-off: `npm run test:eval:multilang:stedi-live` (`VOICE_ELIGIBILITY_SIMULATE=0` + payer sandbox)

### P0 — Operator live prod (Phase 7)

- [ ] **7.1** `operator` — Postgres vs GCS reconciliation on prod (`GCS_DB_BUCKET` + `RETELL_API_KEY` or `POSTGRES_URL`)
- [ ] **7.2** `operator` — Mirror lag gate on prod (`POSTGRES_URL` + `STRICT=1`)
- [ ] **7.3** `operator` — Live PSTN matrix per vertical (`VERTICAL_PSTN_LIVE=1`, `VERTICAL_*_DID`)
- [ ] **7.4** `operator` — Site context all verticals on prod GCS DB (`SITE_CTX_*`)
- [x] **7.5** `operator` — Cloud Run Kelly Rails env OK on revision `somo-middleware-00157-pnf` (`npm run verify:kelly-rails-cloudrun`, 2026-07-10)
- [ ] **7.6** `operator` — Timed rollback drill <15 min: `bash scripts/rollback-gcp-release.sh`
- [ ] **7.8** `operator` — Full `phase7-release-smoke` on staging (portal + PSTN where applicable)
- [x] **7.9** `operator` — `LIVE=1 npm run verify:phase7-deploy-gate` pass after deploy `00157-pnf` (2026-07-10); hosting redeployed (demo form retired)
- [ ] **7.10** `operator` — Tenant provisioning per vertical on prod (`PROVISION_*`, Twilio, GCS pull)

### P0 — Operator live prod (Phase 10)

- [ ] **10.1** `operator` — Bind +363 operator DID on prod; live inbound → `platform_support` ([`PLATFORM_SALES_363_DEPLOY.md`](../docs/deployment/PLATFORM_SALES_363_DEPLOY.md))
- [ ] **10.2** `operator` — Live +363 call → lead tier in `/admin/pipeline.html`

### P0 — Final acceptance (17 steps)

- [ ] **ACC-01–08** `operator` — Dental: signup → voice-setup → PSTN book / cancel / quote / pay on real phone
- [ ] **ACC-09–11** `operator` — Cross-vertical + Mandarin live PSTN (derm, healthcare_clinic, small_business)
- [x] **ACC-12** — Tool firewall Jest green
- [x] **ACC-13** — Multilang strict 19/19
- [ ] **ACC-14** — N/A (Phase 9 deferred)
- [ ] **ACC-15** `operator` — Live +363 → CRM pipeline tiering
- [x] **ACC-16** — Patient portal retired (G4 Path A)
- [ ] **ACC-17** `operator` — Second-person UI walkthrough without engineer

### Deferred — not required to close provider plan

- [ ] **5.17** `deferred` — health-video Firebase rewrite (with Phase 9)
- [ ] **9.1–9.5** `deferred` — Somo Health consumer product (out of active scope)

### P2 — Stretch / hygiene

- [ ] **7.7-EXT** `open` — Expand CDT import 427 → full ADA ~900+ codes (**→ CODING-FOUNDATION B-05**)

**Active epic:** [VOICE-SITE-ESC-EPIC.md](./VOICE-SITE-ESC-EPIC.md) — CallSiteContext (L1.5), escalation ladder, migrations 061–074, post-epic review train.

**Active remediation train:** [VOICE-REMEDIATION-TRAIN.md](./VOICE-REMEDIATION-TRAIN.md) — R-01–R-13 (33 audit issues + gap tracks).

### Post-epic review (T-001–T-018)

Code landed in post-review train; operator gates still open:

- **T-001** — Staging Retell transfer PSTN ring verify (before prod escalation)
- **T-011** — Run `verify-tenant-columns-null-free.cjs` on target DB before migration 074
- **T-013 / T-014** — `voice-routing-matrix-live.cjs --tenant-book` / `--fail-closed`
- **T-015 / T-016** — Staging + prod deploy per OPERATIONS.md
- **Deferred:** SITE-12 full location resolver; meta_kv phase 2 (all call sites)

**SSOT:** This file is the single entry point for open work. Do not maintain parallel status in `CUSTOMER_READY_BACKLOG.md`.

---

## Phase 1 live PSTN gates (2026-06-23)

**Closed in tooling/docs:** `phase1-*` scripts, `PHASE1_PD4_LOG.md`, `PHASE1_DID_INVENTORY.md`, Retell verify fallback for empty GCS `kelly_call_events`.

**PD-4 (5/5):** Verified on revision `00115-v7d` — see [PHASE1_PD4_LOG.md](../docs/deployment/PHASE1_PD4_LOG.md).

**Still blocked (operator):**

| Item | Blocker | Ticket |
|------|---------|--------|
| T-001 PSTN ring | Twilio API probes disconnect ~5s; no inbound to `+12028131474` | **R-06-4** REST `POST /v2/call/{id}/transfer` fallback in `retell-websocket.js` |
| Live tenant booking + portal | `verify-tenant-site-context` FAIL on GCS for `cust_96848972…`; portal appointments empty | Stamp site context on prod DB or capstone preseed; external PSTN booking |
| GCS verify scripts | `POSTGRES_PRIMARY=1` — GCS SQLite has 0 Kelly events | Add Postgres read path to live verify scripts or fix upload flush |

**Tenant DID SSOT:** `+18623622415` (not `+18622307479` — not on Twilio account).

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

**Plan:** [`docs/plans/CURSOR_PRODUCTION_PLAN.md`](../docs/plans/CURSOR_PRODUCTION_PLAN.md) Phase 10 (demo conversion items complete)

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
- [ ] **RS-2-04** `deferred` — Split `server.js` per [`LIVE.md § server decomposition`](../docs/architecture/LIVE.md#server-decomposition)
- [ ] **RS-2-05** `deferred` — Formalize `Knowledge/` boundary (`@somo/knowledge` workspace or `data/knowledge` symlink)
- [ ] **RS-2-06** `deferred` — Consolidate `middleware-platform/scripts/` into `payor/`, `verify/`, `seed/` subdirs
- [ ] **RS-2-07** `deferred` — Continue Postgres-primary path per `docs/Database/OPERATIONS.md` — reduce dual-write complexity

---

## P0 — Customer-ready prod gates

Full detail + file paths: archived in [`docs/CUSTOMER_READY_BACKLOG.md`](../docs/CUSTOMER_READY_BACKLOG.md) (CR ticket index only).

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
- [ ] **CR-065** `partial` — Rollback runbook tested (<15 min) — see [`docs/runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md`](../docs/runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md)
- [x] **FE-016** `done` — Split `settings.html` into tab modules (Phase 5.4)
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

**SSOT:** [`LIVE.md § kelly agentic rails`](../docs/architecture/LIVE.md#kelly-agentic-rails-target-and-build-plan)

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

## BRAND-PRUNE-2026 — Pre-Phase 3 (healthcare financial agent)

**SSOT:** [`docs/plans/CURSOR_PRODUCTION_PLAN.md`](../docs/plans/CURSOR_PRODUCTION_PLAN.md) · Master plan (deferred consumer): [`docs/architecture/HEALTH_SESSION_ARCHITECTURE.md`](../docs/architecture/HEALTH_SESSION_ARCHITECTURE.md)

**Stop line:** Do not start P3 finance rails until all items below are green.

### Wave A — Narrative lock (docs)
- [x] README → healthcare financial agent positioning
- [x] SOMO_GUIDELINES — Kelly PA vs Kelly front desk split
- [x] CANONICAL_DOC_MAP — healthcare financial agent row
- [x] HEALTH_SESSION_ARCHITECTURE — P3 finance preview
- [x] VIDEO_HEALTH — copay roadmap copy
- [x] derm-education manifest — Somo branding
- [x] Cursor rule alignment

### Wave B — Code gates
- [x] `COMMERCE_LEGACY_ENABLED=false` default; gate commerce mounts in `server.js`
- [x] Fix `trySendLittleLabOrPublicLanding` undefined; LittleLab dead paths
- [x] `patient-app/DEPRECATED.md`; legacy health JS confirmed deprecated
- [x] Brand CI hardening for health paths
- [x] Route ownership table in `docs/architecture/ROUTE_OWNERSHIP.md` + `LIVE.md`

### Health acceptance gates (H1–H6)
- [x] Health Jest in `ci-local.sh` gate (21 tests)
- [x] Multi-turn memory test green
- [x] Report from DB (health-session-report-service)
- [x] Auth on `/turn`, `/end`, SSE token
- [x] Health isolation regression
- [x] `ci:phase0` green (2026-06-25)

### Wave C — Monolith rules (before P3)
- [x] `database.js` + `server.js` policy banners
- [x] `bootstrap/health-ui.js` extract
- [x] `routes/index.js` mount registry (health first)
- [x] `database/repos/health-session.js`
- [x] `database/repos/payment.js` prep
- [x] `webhooks/retell/health-session-guard.js` + commerce block on health metadata
- [x] `scripts/check-monolith-growth.cjs`

### Wave D — Phase 3 finance (start after above)
Eligibility, copay panel, Stripe, webhooks, Circle — see master plan `p3-*` todos.

### Wave E — Hard delete (after P3 stub)
Commerce routes, PSTN replay fixtures, skincare services — master plan `later-delete-*`.

**Route table:** [`docs/architecture/LIVE.md`](../docs/architecture/LIVE.md#route-ownership-pre-phase-3)

---

## P1 — Kelly coding program (MT–PY backlog)

**SSOT:** [`docs/Medical Coding/KELLY_CODING_MASTER_EXECUTION_PLAN.md`](../docs/Medical%20Coding/KELLY_CODING_MASTER_EXECUTION_PLAN.md) §6

Scheduled eng backlog after CODING-FOUNDATION closeout. **Do not parallelize** per risk register (CP-05 before BL; MT-02 before DN; MT-03 + D-01 before AD-01).

### Phase 5 — Multitenant (G0) — eng complete 2026-07-11

- [x] **MT-01** Tenant SSOT schema — `pinecone-code-metadata-ingest.cjs` + [`PINECONE_TENANT_INGEST.md`](../docs/Medical%20Coding/PINECONE_TENANT_INGEST.md)
- [x] **MT-03** Pinecone tenant filter + caller audit + CI gate *(2026-07-10)*
- [x] **MT-02** Unified benefits — [`BENEFITS_PRECEDENCE.md`](../docs/Medical%20Coding/BENEFITS_PRECEDENCE.md)
- [x] **MT-04** SQLite tenant-boundary audit — `verify-sqlite-tenant-boundary.cjs`
- [x] **MT-05** Pinecone ingest tenant tagging — export hook in `populate-code-embeddings.js`
- [x] **MT-06** Cross-tenant filter metrics — `pinecone_tenant_filter_reject`
- [x] **MT-07** Per-clinic starter sets — `CLINIC_STARTER_SET_MAP` in `resolve-admin-visit-codes.js`
- [x] **MT-08** Multitenant eval fixture — `ci-coding-db-fixture.cjs` clinic-a/b + isolation tests
- [x] **MT-09** PSTN spot-check runbook — OPERATIONS.md Appendix

### Phase 6 — Conversation pipeline (G1) — eng complete 2026-07-11

- [x] **CP-01..CP-04** OPQRST registry, triage v2 default, voice/chat asymmetry doc, mode audit scripts
- [x] **CP-05** Ranking SSOT — `select-primary-codes` + `verify-ranking-ssot.cjs` + eval primary ranking
- [x] **CP-06..CP-14** v2 SSOT boundary, collect spine, specialty/latency tests, nightly `EVAL_PRIMARY_RANKING`

### Phase 7 — Billing + dental (G2–G3) — eng complete 2026-07-11

- [x] **BL-01..BL-08** NCCI expanded (58 rules), modifier/E/M tests, pair eval threshold
- [x] **DN-01..DN-09** CDT `--licensed`, 50 phrase map, 24 dental eval cases, PSTN eval, G3 checklist doc

### Phase 8 — Admin + payment + deploy (G4–G5) — eng complete 2026-07-11

- [x] **AD-01..AD-08** RAG ADR, tenant matrix draft, starter sets, provenance store *(clinical sign-off AD-08 pending)*
- [x] **PY-01..PY-05** `plan-rules-benefits-scale.json` + populated [`COVERAGE_MATRIX.md`](../docs/Medical%20Coding/COVERAGE_MATRIX.md)
- [x] **DP-02..DP-09** `--cloudrun` verify, GCS upload script, nightly failure notify, operator appendix-a-local

**Link gate:** `node scripts/check-coding-ssot-links.cjs` (Gov-03)

---

## Summary

| Priority | Workstream | ~Open items |
|----------|------------|-------------|
| **P0** | **Production plan closure** (see section above) | **14 operator/legal** (+ 1 blocked Stedi live + 1 stretch CDT) |
| **P0** | Demo Phase 1 conversion | **0** (complete) |
| **P0** | Codebase & DB structure (RS-0, RS-1) | **0** (complete) |
| **P0** | RS-2 refactors | **6** (deferred) |
| **P0** | Customer-ready CR/FE (engineering) | **~12** operator + **~5** deferred |
| **P1** | Demo operator sign-off | **3** (operator) |
| **P1** | Kelly coding program (MT–PY) | **0** eng *(operator/clinical gates above)* |
| **P1** | Kelly Phase C sign-off | **24** (clinical/operator; overlaps CF-OP-5 / F-09) |
| **Kelly Master Plan only** | Operator + appendix + optional | **25** (see inventory above) |
| **P2** | RCM, telemedicine, payor, GCP, photo-to-bill, UI polish | **~40** (deferred) |
| **P3** | Commerce checkout, LangGraph, derm Q&A, legacy funnel | deferred |
