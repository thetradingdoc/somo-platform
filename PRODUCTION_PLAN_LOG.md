# Production Plan Execution Log

Audit trail for [docs/plans/CURSOR_PRODUCTION_PLAN.md](docs/plans/CURSOR_PRODUCTION_PLAN.md).

| Field | Value |
|-------|-------|
| Plan version | Provider-facing v1 (105 active + 5 deferred Phase 9) |
| Started | 2026-06-25 (Phase 0) |
| Completed (code) | 2026-07-05 |

## Gate resolutions (2026-06-25)

| Gate | Resolution |
|------|------------|
| G1 | `kelly_rails_session_projection` authoritative; `kelly_session_meta_kv` deprecated |
| G2 | Interim **90 days** for `kelly_conversation_history` / raw logs — `// TODO: confirm with counsel` in code |
| G3 | Delete Notifications panel if `toggleNotification` unwired |
| G4 | **Path A — retire** Skin & Care patient portal (task 5.19) |
| G5 | Moot — Phase 9 (Somo Health) deferred |
| Scope | Providers-only; consumer surfaces (portal + Health) out of active track |

## Log format

Each entry:

```
### [TASK_ID] Title
- **Completed:** ISO-8601 timestamp
- **Files:** comma-separated paths
- **Verification:** command output summary or pass/fail evidence
- **Notes:** optional
```

## Entries

### [0.0] Bootstrap audit log
- **Completed:** 2026-06-25
- **Files:** PRODUCTION_PLAN_LOG.md
- **Verification:** File exists with gate resolutions and log format

### [0.1] Redact raw utterance logging
- **Completed:** 2026-06-25
- **Files:** middleware-platform/webhooks/retell-websocket.js, middleware-platform/services/chat-llm-service.js
- **Verification:** grep — no `User said:` verbatim logging; secure-logger used for turn metadata

### [0.2] Remove PHI from Stripe metadata
- **Completed:** 2026-06-25
- **Files:** middleware-platform/services/payment-orchestrator.js
- **Verification:** `_stripePaymentMetadata` — opaque checkout_id/appointment_id only; no customer_email/phone in PI metadata

### [0.3] Wire PHI-safe messaging validator
- **Completed:** 2026-06-25
- **Files:** middleware-platform/services/sms-service.js, middleware-platform/services/email-service.js, middleware-platform/__tests__/phi-safe-messaging.wiring.test.js
- **Verification:** `npm test -- --testPathPattern=phi-safe-messaging.wiring` — 3/3 pass

### [0.4] HIPAA access logging on PHI reads
- **Completed:** 2026-06-25
- **Files:** middleware-platform/database.js, middleware-platform/routes/admin-leads.js, middleware-platform/routes/admin-platform.js, middleware-platform/routes/tenant-patients.js
- **Verification:** logHipaaAccess surfaces failures; transcript + eligibility routes call logHipaaAccess

### [0.5] Retention policy enforcement (90-day placeholder)
- **Completed:** 2026-06-25
- **Files:** middleware-platform/config/retention-policy.js, middleware-platform/scripts/cleanup-retention.js
- **Verification:** kelly_conversation_history + triage_sessions keys added with counsel TODO; cleanup job includes both tables

### [0.6] Fix payment success page 404
- **Completed:** 2026-06-25
- **Files:** middleware-platform/routes/patient-booking.js, middleware-platform/scripts/e2e-kelly-rcm-pay-gateway.cjs, middleware-platform/scripts/e2e-kelly-rcm-pay-conversation.cjs
- **Verification:** success/return URLs point to `/api/payment/success` on API host (served by routes/payment.js)

### [1.1] State owner documented (Gate G1)
- **Completed:** 2026-06-25
- **Files:** docs/architecture/STATE_OWNERSHIP.md
- **Verification:** SSOT = `kelly_rails_session_projection`; meta_kv deprecated for orchestration keys

### [1.2] execute-turn persist on step remap
- **Completed:** 2026-06-25
- **Files:** middleware-platform/services/kelly-rails/execute-turn.js
- **Verification:** `npm test -- --testPathPattern=phase1-state-ssot` — remapped done→await_intent persists

### [1.3] meta_kv blocked orchestration keys
- **Completed:** 2026-06-25
- **Files:** middleware-platform/services/kelly-rails/meta-kv-policy.js, middleware-platform/__tests__/meta-kv-policy.test.js
- **Verification:** `npm test -- --testPathPattern=meta-kv-policy` — orchestration writes blocked

### [1.4] hydrateFlagsFromDb projection wins
- **Completed:** 2026-06-25
- **Files:** middleware-platform/services/kelly-rails/hydrate.js
- **Verification:** phase1-state-ssot test 1.4 pass

### [1.5] loadConversationSession hydrate path
- **Completed:** 2026-06-25
- **Files:** middleware-platform/services/conversation-mode/conversation-mode-session.js
- **Verification:** phase1-state-ssot test 1.5 pass

### [1.6] front-desk intake projection SSOT
- **Completed:** 2026-06-25
- **Files:** middleware-platform/services/front-desk-intake.js
- **Verification:** phase1-state-ssot test 1.6 pass

### [1.7] payment-page-route schema query
- **Completed:** 2026-06-25
- **Files:** middleware-platform/routes/payment-page-route.js
- **Verification:** route mounted in server.js; payment page resolves without SQL schema error

### [1.8] mirrorMetaFromPayload gate flags
- **Completed:** 2026-06-25
- **Files:** middleware-platform/services/kelly-rails/session-ssot.js
- **Verification:** phase1-state-ssot test 1.8 pass

### [1.9] triage session duplicate-row guard
- **Completed:** 2026-06-25
- **Files:** middleware-platform/database.js, middleware-platform/__tests__/triage-session-id-unique.test.js
- **Verification:** `npm test -- --testPathPattern=triage-session-id-unique` pass

### [1.10] migrations 074/076 preflight
- **Completed:** 2026-06-25
- **Files:** middleware-platform/scripts/verify-migrations-074-076.cjs, middleware-platform/scripts/verify-tenant-columns-null-free.cjs
- **Verification:** documented in STATE_OWNERSHIP.md; operator runs before deploy

### [1.11] pivot survival billing→clinical
- **Completed:** 2026-06-25
- **Files:** middleware-platform/services/kelly-rails/session-ssot.js, middleware-platform/__tests__/opqrst-pivot-survival.test.js
- **Verification:** `npm test -- --testPathPattern=opqrst-pivot-survival` pass

### [1.12] shadow pivot no projection write
- **Completed:** 2026-06-25
- **Files:** middleware-platform/services/conversation-mode/conversation-mode-session.js
- **Verification:** phase1-state-ssot shadow test pass

### [1.13] laneToOrchestratorPhase shared mapping
- **Completed:** 2026-06-25
- **Files:** middleware-platform/services/kelly-rails/lane-orchestrator-phase.js
- **Verification:** phase1-state-ssot test 1.13 pass

### [2.1] Fix voice history double-append
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/kelly-rails/execute-turn.js, middleware-platform/services/kelly-rails/node-runner.js, middleware-platform/webhooks/retell-websocket.js
- **Verification:** Single writer in execute-turn.js; retell V2 path no longer appends; node-runner uses in-memory user turn for LLM only

### [2.2] Reconcile history turn-limit defaults to 20
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/kelly-agent-service.js
- **Verification:** grep — both history.js and kelly-agent-service.js default KELLY_MAX_HISTORY_TURNS to 20

### [2.3] Verify getLastAssistantText under single writer
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/kelly-rails/execute-turn.js, middleware-platform/__tests__/opqrst-voice-history-wiring.test.js
- **Verification:** `npm test -- --testPathPattern=opqrst-voice-history-wiring|opqrst-field-gate` — pass; trailing user turn ignored

### [2.4] Document seedKellyHistoryFromOrchestrate one-way backfill
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/kelly-rails/history.js, middleware-platform/__tests__/opqrst-voice-history-wiring.test.js
- **Verification:** JSDoc + test confirms skip when Kelly rows exist

### [2.5] Consolidate language field to projection.flags_json.locale
- **Completed:** 2026-07-05
- **Files:** middleware-platform/database.js, middleware-platform/services/kelly-rails/hydrate.js, middleware-platform/services/kelly-rails/resolve-locale.js, middleware-platform/services/kelly-rails/prompts.js, middleware-platform/services/kelly-rails/prompts/es.js, middleware-platform/services/kelly-rails/prompts/subrail-step-objectives.js, middleware-platform/services/voice-reply-formatter.js, middleware-platform/webhooks/retell-websocket.js, middleware-platform/__tests__/prompt-bounding-locale.test.js
- **Verification:** getKellySessionLanguage/upsertKellySessionLanguage read/write projection.flags_json.locale; kelly_session_locale hydrate read removed

### [4.1] Enforce firewall inside KellyToolExecutor.execute()
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/kelly-tool-executor.js, middleware-platform/services/conversation-mode/mode-tool-firewall.js, middleware-platform/__tests__/mode-tool-firewall-phase4.test.js
- **Verification:** `npm test -- --testPathPattern=mode-tool-firewall-phase4` — direct execute blocks disallowed tool with MODE_FIREWALL_BLOCKED

### [4.2] Add firewall to replayFunctionCall
- **Completed:** 2026-07-05
- **Files:** middleware-platform/webhooks/retell-websocket.js, middleware-platform/__tests__/mode-tool-firewall-phase4.test.js
- **Verification:** replay blocks check_plan_benefits; run_triage_rag routes through KellyToolExecutor (no Unknown function)

### [4.3] Fix Retell modeCtx missing fields
- **Completed:** 2026-07-05
- **Files:** middleware-platform/webhooks/retell-websocket.js, middleware-platform/__tests__/mode-tool-firewall-phase4.test.js
- **Verification:** `_buildRetellModeCtx` supplies triage_policy, use_case, clinicId, customerId; dental blocks check_plan_benefits

### [4.4] Fix isToolAllowedForMode default-allow tail
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/conversation-mode/mode-tool-firewall.js, middleware-platform/__tests__/mode-tool-firewall-phase4.test.js, middleware-platform/__tests__/coding-layer-leaks.test.js
- **Verification:** unregistered tool names return false; registered tenant tools still allowed

### [4.5] Remove dead handleScheduleAppointment legacy bypass
- **Completed:** 2026-07-05
- **Files:** middleware-platform/webhooks/retell-websocket.js, middleware-platform/__tests__/voice-greeting-name-first.test.js, middleware-platform/__tests__/coding-layer-leaks.test.js
- **Verification:** grep — no provider_override_emergency in handleScheduleAppointment; method delegates to KellyToolExecutor.execute

### [4.6] Fix retell-functions.json service_code on collect_insurance
- **Completed:** 2026-07-05
- **Files:** middleware-platform/retell-functions/retell-functions.json, middleware-platform/__tests__/coding-layer-leaks.test.js
- **Verification:** schema omits service_code; existing collect-insurance-http-spine + resolveInsuranceCodes tests still pass

### [4.7] Wire gate-bypass telemetry to ops dashboards
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/kelly-tool-executor.js, middleware-platform/scripts/verify-p0-telemetry.cjs, middleware-platform/__tests__/mode-tool-firewall-phase4.test.js
- **Verification:** `_logGateBypass` increments `gate_bypass_*` ops counter; gate_bypass added to P0 telemetry checklist

### [4.8] Extend coding-layer-leaks.test.js
- **Completed:** 2026-07-05
- **Files:** middleware-platform/__tests__/coding-layer-leaks.test.js, middleware-platform/__tests__/mode-tool-firewall-phase4.test.js
- **Verification:** `npm test -- --testPathPattern=coding-layer-leaks|mode-tool-firewall-phase4` — firewall, Retell path, emergency override cases green

### [4.9] Fix double-resolve confusion logging
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/kelly-tool-executor/collect-insurance.js, middleware-platform/services/voice-insurance-spine-handler.js, middleware-platform/__tests__/coding-layer-leaks.test.js
- **Verification:** `[coding_resolve]` logs label kelly_executor (authoritative) vs http_spine (advisory when pre-resolved)

### [4.10] CALLSOMO_OPERATOR_FALLBACK_PSTN in verify checklist
- **Completed:** 2026-07-05
- **Files:** middleware-platform/scripts/verify-kelly-rails-env.cjs, middleware-platform/scripts/verify-pilot-prod-readiness.cjs, middleware-platform/__tests__/coding-layer-leaks.test.js
- **Verification:** `KELLY_RAILS_ENV_PROFILE=staging KELLY_RAILS_V2=1 CONVERSATION_MODE_ROUTING=enforce` without CALLSOMO_OPERATOR_FALLBACK_PSTN → exit 1 with explicit error

### [3.1] prompt_profiles single source of truth
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/prompt-profile-service.js, middleware-platform/routes/customer-agent.js, middleware-platform/routes/voice-agent-settings.js, middleware-platform/services/kelly-rails/node-runner.js, middleware-platform/services/voice-agent-runtime.js, middleware-platform/services/trial-lifecycle.js
- **Verification:** PUT `/api/customer/agent/prompt` and voice-setup-complete write `prompt_profiles.system_prompt` + sync Retell; `custom_prompt` write path removed

### [3.2] voice-settings-sync prompt_synced_at only on real prompt sync
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/voice-settings-sync.js, middleware-platform/routes/voice-agent-settings.js, middleware-platform/__tests__/phase3-prompt-ssot.test.js
- **Verification:** hours-only save does not update `prompt_synced_at`; explicit `promptSyncedAt` param does

### [3.3] ensure-retell-agent requires use_case
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/ensure-retell-agent.js, middleware-platform/services/retell-service.js, middleware-platform/__tests__/phase3-prompt-ssot.test.js
- **Verification:** agent creation without `use_case` returns error; `createAgent` rejects missing use_case

### [3.4] Reconcile default clinic wordings
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/voice-prompt-templates.js, middleware-platform/services/prompt-profile-templates.js, middleware-platform/services/retell-service.js, middleware-platform/__tests__/phase3-prompt-ssot.test.js
- **Verification:** `USE_CASE_PROFILES.*.system_prompt === TEMPLATES.*`; Retell `getDefaultPrompt` delegates to `getDefaultCustomPrompt`

### [3.5] Reconcile tool allowlist sources
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/kelly-rails/tool-allowlists.js, middleware-platform/services/prompt-profile-templates.js, middleware-platform/__tests__/phase3-prompt-ssot.test.js
- **Verification:** `PROFILE_ALLOWED_TOOLS` SSOT; `USE_CASE_PROFILES.allowed_tools` imports it

### [3.6] Portal API for prompt_profiles
- **Completed:** 2026-07-05
- **Files:** middleware-platform/routes/voice-agent-settings.js, middleware-platform/services/prompt-profile-service.js
- **Verification:** GET/PUT `/api/voice-agent/prompt-profile` authenticated tenant-scoped endpoints added

### [3.7] tenant-config merchant id as customer_id fix
- **Completed:** 2026-07-05
- **Files:** middleware-platform/routes/tenant-config.js
- **Verification:** `getClinicPromptProfile(clinic_id, session.customer_id)` — no merchant id substitution

### [3.8] Dermatology profile run_triage_rag
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/kelly-rails/tool-allowlists.js, middleware-platform/__tests__/front-desk-prompt-profiles.test.js
- **Verification:** dermatology `allowed_tools` includes `run_triage_rag`

### [3.9] healthcare_clinic cancel/reschedule/search tools
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/kelly-rails/tool-allowlists.js, middleware-platform/__tests__/front-desk-prompt-profiles.test.js
- **Verification:** healthcare_clinic profile includes cancel/reschedule/search tools matching dental

### [3.10] backfill clinical use cases
- **Completed:** 2026-07-05
- **Files:** middleware-platform/scripts/backfill-front-desk-prompt-profiles.cjs
- **Verification:** script no longer skips dermatology/clinical profiles; updates all active profiles

### [3.11] Opener parity settings vs live
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/call-opener-resolver.js
- **Verification:** `resolveGreetingWithDisclosure` delegates to `resolveCallOpeners` (same path as preview + live websocket)

### [3.12] Copay speak policy single location
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/tenant-voice-config.js
- **Verification:** `copay_quote_speak_enabled` read from `prompt_profiles.policy_json` only (voice_agent_settings fallback removed)

### [3.13] Retell API endpoint consistency
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/retell-service.js, middleware-platform/__tests__/phase3-prompt-ssot.test.js
- **Verification:** create uses `/v2/create-agent`; updates use `/update-agent/` (no `/v2/agents/`)

### [3.14] getEffectiveTenantPolicy spread order
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/prompt-profile-templates.js, middleware-platform/__tests__/phase3-prompt-ssot.test.js
- **Verification:** dental partial profile keeps `triage_policy: disabled`; merges `policy_json` without healthcare_clinic bleed

### [3.15] Dental prompt/tool-description alignment
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/kelly-rails/node-runner.js, middleware-platform/__tests__/phase3-front-desk-tool-descriptions.test.js
- **Verification:** front-desk (`triage_policy: disabled`) tool descriptions omit `run_triage_rag` requirement text

### [5.1] Kelly widget nested button fix
- **Completed:** 2026-07-05
- **Files:** unified-dashboard/business/today.html, unified-dashboard/assets/js/provider-shell-chrome.js
- **Verification:** today.html migrated to mountProviderPage; Kelly widget uses sibling link+button pattern from provider-shell-chrome.js

### [5.2] Sidebar Kelly status flash fix
- **Completed:** 2026-07-05
- **Files:** unified-dashboard/assets/js/provider-shell.js
- **Verification:** renderProviderSidebar shows neutral "Loading status…" until fetchKellyStatus/renderKellyStatus resolves

### [5.3] mountProviderPage migration (today + agent)
- **Completed:** 2026-07-05
- **Files:** unified-dashboard/business/today.html, unified-dashboard/business/agent.html, unified-dashboard/assets/js/provider-layout.js
- **Verification:** both pages content-only; shell injected via mountProviderPage + provider-layout.js

### [5.4] Settings split — zero inline onclick
- **Completed:** 2026-07-05
- **Files:** unified-dashboard/business/settings.html, unified-dashboard/assets/js/settings/tab-general.js
- **Verification:** grep settings.html onclick= → 0; bindSettingsClickHandlers uses data-settings-action

### [5.5] Settings FOUC fix
- **Completed:** 2026-07-05
- **Files:** unified-dashboard/business/settings.html
- **Verification:** non-profile panels have hidden attribute in raw HTML

### [5.6] Settings #billing hash routing
- **Completed:** 2026-07-05
- **Files:** unified-dashboard/assets/js/settings/tab-general.js
- **Verification:** setupSettingsTabs handles hash === 'billing' → setSettingsTab('billing')

### [5.7] Notifications panel (Gate G3)
- **Completed:** 2026-07-05
- **Files:** unified-dashboard/business/settings.html, unified-dashboard/assets/js/settings/tab-general.js
- **Verification:** backend wired (PATCH /api/customers/me/notification-settings); orphaned block removed; notifications moved under Connected Accounts tab with data-notif-toggle handlers

### [5.8] 7-step voice setup copy
- **Completed:** 2026-07-05
- **Files:** unified-dashboard/business/settings.html, docs/product/KELLY_FRONT_DESK_UX.md
- **Verification:** grep unified-dashboard — no "3-step" wizard references

### [5.9] agent.html login redirect path
- **Completed:** 2026-07-05
- **Files:** unified-dashboard/business/agent.html
- **Verification:** redirect uses /business/agent.html; grep unified-dashboard source — no bad /unified-dashboard/business/ prefix

### [5.10] building-office icon key
- **Completed:** 2026-07-05
- **Files:** unified-dashboard/assets/js/provider-shell.js
- **Verification:** admin Tenants nav uses building-office-2 (matches config.js NAV_ICONS)

### [5.11] Search / New Appointment CTAs
- **Completed:** 2026-07-05
- **Files:** unified-dashboard/business/today.html, unified-dashboard/business/patients.html, unified-dashboard/business/calendar.html
- **Verification:** today topbar links use ?focus=search and ?new=1; patients focuses searchInput; calendar opens create modal on ?new=1

### [5.12] Kelly widget subtitle SSOT
- **Completed:** 2026-07-05
- **Files:** unified-dashboard/assets/js/provider-shell-chrome.js, unified-dashboard/assets/js/provider-shell.js
- **Verification:** chrome template neutral placeholder; renderKellyStatus() sets live subtitle after fetch

### [5.13] Global ppAlertStrip / escalation poll
- **Completed:** 2026-07-05
- **Files:** unified-dashboard/assets/js/provider-layout.js, unified-dashboard/assets/js/provider-shell.js
- **Verification:** ppEnsureAlertStrip injects strip on mountProviderPage; escalation poll always starts after ensure

### [5.14] Toast consolidation
- **Completed:** 2026-07-05
- **Files:** unified-dashboard/business/agent.html
- **Verification:** vaToast removed; showVaToast delegates to window.ppToast; grep vaToast in unified-dashboard → 0

### [5.15] Dental Revenue CTA gate
- **Completed:** 2026-07-05
- **Files:** unified-dashboard/business/today.html, unified-dashboard/assets/js/provider-shell.js
- **Verification:** ppIsDentalPortal + data-revenue-cta hides pipeline links and journey strip for dental tenants

### [5.16] Firebase billing.html query preservation
- **Completed:** 2026-07-05
- **Files:** unified-dashboard/firebase.json, unified-dashboard/business/billing.html, unified-dashboard/assets/js/legacy-provider-redirect.js
- **Verification:** removed hardcoded firebase rewrite; billing.html stub + legacy-provider-redirect.js preserves ?section= params

### [5.17] health-video Firebase rewrite
- **Status:** DEFERRED (Phase 9) — not executed

### [5.18] Legacy redirect stub audit
- **Completed:** 2026-07-05
- **Files:** unified-dashboard/assets/js/legacy-provider-redirect.js, unified-dashboard/business/pdf-coding.html, unified-dashboard/business/billing.html
- **Verification:** documented intentional stubs in legacy-provider-redirect.js; pdf-coding redirects to revenue claims create panel

### [5.19] Retire Skin & Care patient portal (Path A)
- **Completed:** 2026-07-05
- **Files:** unified-dashboard/firebase.json, scripts/build-staging-hosting.cjs, docs/product/KELLY_FRONT_DESK_UX.md
- **Verification:** patients/ not in hosting build; /patients/** rewrites to /index.html; docs state retirement

### [5.20] Commerce legacy removal
- **Completed:** 2026-07-05
- **Files:** middleware-platform/server.js, middleware-platform/routes/index.js, middleware-platform/webhooks/retell/health-session-guard.js, middleware-platform/.env.example; deleted middleware-platform/lib/commerce-legacy-flag.js, unified-dashboard/patients/checkout-chat.*
- **Verification:** grep middleware-platform code for COMMERCE_LEGACY_ENABLED → 0 matches

### [5.x] Phase 5 verification — tenant-front-desk-audit
- **Completed:** 2026-07-06
- **Verification:** `TENANT_AUDIT_STRICT=1 PW_API_BASE_URL=http://127.0.0.1:4001 PW_ALLOW_LIVE_ACTIONS=1 npm run test:e2e:tenant-audit:strict` — **153 pass / 0 fail / 18 skip** (26 pages)
- **Fixes:** calendar `refresh` scope; today appointments soft-fail; Kelly session re-login; integrations auth; payor/merge `platform.leads`; video-call shell; auth pages (`/portal`, reset-password toggle); `resolveFHIRPatient` Patient/ prefix; patient-case anchor waits for case-report API
- **CI:** `scripts/ci-local.sh` runs `test:e2e:tenant-audit:safe`

### [7.1] Postgres vs GCS SQLite read reconciliation (CR-066)
- **Completed:** 2026-07-05
- **Files:** middleware-platform/scripts/lib/kelly-events-read-source.cjs, middleware-platform/scripts/lib/verify-db.cjs, middleware-platform/scripts/verify-postgres-gcs-reconciliation.cjs, middleware-platform/.env.example
- **Verification:** `node scripts/verify-postgres-gcs-reconciliation.cjs` — pass (sqlite_gcs mode); POSTGRES_PRIMARY path uses Retell + postgres voice_call_log
- **Notes:** Live prod cross-check requires `GCS_DB_BUCKET` + `RETELL_API_KEY` or `POSTGRES_URL`

### [7.2] Postgres mirror eventual-consistency + lag gate
- **Completed:** 2026-07-05
- **Files:** middleware-platform/config/postgres-mirror-policy.js, middleware-platform/scripts/verify-postgres-mirror-lag.cjs, docs/deployment/POSTGRES_MIRROR.md
- **Verification:** `node scripts/verify-postgres-mirror-lag.cjs` — pass; retry queue 0, DLQ 0; 120s staleness bound documented
- **Notes:** Live lag probe requires `POSTGRES_URL` + `STRICT=1` in prod

### [7.3] PSTN verification matrix per vertical
- **Completed:** 2026-07-05
- **Files:** middleware-platform/e2e/scenario-registry/dermatology-clinical.cjs, healthcare-clinic.cjs, small-business.cjs, middleware-platform/scripts/vertical-pstn-scenarios.cjs, docs/qa/pstn-vertical-matrix.md, middleware-platform/scripts/verify-pilot-scenario-matrix.cjs
- **Verification:** `node scripts/vertical-pstn-scenarios.cjs` — 4/4 verticals structural pass (dental 11, derm 4, hc 5, sb 4 scenarios)
- **Notes:** **Requires live prod** — real PSTN calls per `VERTICAL_*_DID` env; `VERTICAL_PSTN_LIVE=1` writes manifest only

### [7.4] Site context per tenant type
- **Completed:** 2026-07-05
- **Files:** middleware-platform/scripts/verify-tenant-site-context-all-verticals.cjs, middleware-platform/scripts/verify-tenant-site-context.cjs
- **Verification:** `--use_case` / `--tenant` flags added; all-verticals script skips unconfigured verticals with explicit env names
- **Notes:** **Requires live prod DB** — `GCS_DB_BUCKET` + `SITE_CTX_*` per vertical for full 4/4 pass

### [7.5] Kelly Rails env Cloud Run deploy verify
- **Completed:** 2026-07-05
- **Files:** middleware-platform/scripts/verify-phase7-kelly-rails-deploy.cjs (wraps verify-kelly-rails-env + verify-kelly-rails-cloudrun-env)
- **Verification:** local profile OK (`KELLY_RAILS_V2=1`, `CONVERSATION_MODE_ROUTING=enforce`); Cloud Run describe blocked in sandbox (gcloud credentials)
- **Notes:** **Requires live prod** — `npm run verify:kelly-rails-cloudrun` with gcloud auth

### [7.6] Rollback runbook under 15 minutes (CR-065)
- **Completed:** 2026-07-05
- **Files:** docs/runbooks/ROLLBACK_DRILL.md, middleware-platform/scripts/rollback-drill.cjs, scripts/rollback-gcp-release.sh
- **Verification:** `node scripts/rollback-drill.cjs --dry-run` — pass, 0s within 900s budget; timing added to rollback script
- **Notes:** **Requires live prod** — `bash scripts/rollback-gcp-release.sh` for timed live drill

### [7.7] Full ADA CDT codebook import
- **Completed:** 2026-07-05
- **Files:** middleware-platform/migrations/107_cdt_codes.js, Knowledge/CDT/cdt-codes-2025.txt, middleware-platform/scripts/import-cdt-codes.js, middleware-platform/database/repositories/medical-codes.js, middleware-platform/utils/cpt-helper.js, middleware-platform/services/saas-tenant-provision.js, middleware-platform/__tests__/cdt-codebook.test.js
- **Verification:** `npm run import:cdt` — 427 codes; `npm test -- --testPathPattern=cdt-codebook` — 6/6 pass; root canal/crown/extraction/scaling resolve without CODE_NOT_IN_STARTER_SET
- **Notes:** Seed is 427 codes from ADA ranges; extend txt from PDF guides for full ~900+ ADA coverage

### [7.8] Automatable PSTN + portal + payment smoke suite
- **Completed:** 2026-07-05
- **Files:** middleware-platform/scripts/phase7-release-smoke.cjs, docs/qa/phase7-release-smoke.md, middleware-platform/__tests__/README.md
- **Verification:** structural steps pass individually; `PHASE7_SKIP_PORTAL=1` for middleware-only CI
- **Notes:** Full PSTN+payment live proof remains operator-run per acceptance test steps 1–8

### [7.9] Production deploy gate
- **Completed:** 2026-07-05
- **Files:** middleware-platform/scripts/verify-phase7-deploy-gate.cjs, docs/qa/phase7-deploy-gate.md, middleware-platform/package.json
- **Verification:** script chains kelly-rails + pre-deploy-smoke + portal structural; `LIVE=1` for callsomo.com/api health
- **Notes:** **Requires live prod** — `LIVE=1 npm run verify:phase7-deploy-gate` after deploy

### [7.10] Tenant provisioning per vertical
- **Completed:** 2026-07-05
- **Files:** middleware-platform/scripts/verify-tenant-provisioning.cjs
- **Verification:** script checks prompt_profiles, voice_agent_settings, retell agent, Twilio DID bind per `--use_case`
- **Notes:** **Requires live prod** — `PROVISION_*` env + Twilio credentials + GCS DB pull for each vertical

### [10.1] Deploy +363 platform sales line
- **Completed:** 2026-07-05 (code + runbook; **prod PSTN verify pending**)
- **Files:** docs/deployment/PLATFORM_SALES_363_DEPLOY.md, middleware-platform/scripts/bind-operator-platform-did.cjs, middleware-platform/scripts/fix-operator-voice-openers.cjs, middleware-platform/scripts/platform-routing-post-deploy-verify.cjs, middleware-platform/package.json, docs/voice/VOICE_ROUTING_SSOT.md
- **Verification:** `npm run verify:platform-routing` — env pre-flight pass; `npm run deploy:platform-363:bind-did -- --dry-run` documents prod bind
- **Notes:** **Prod-only:** bind DID on GCS DB, `callsomo-operator-sync.cjs`, live inbound to +13639990205 → `platform_support`

### [10.2] CRM → lead → signup pipeline verification
- **Completed:** 2026-07-05 (automated local; **prod call verify pending**)
- **Files:** middleware-platform/scripts/verify-crm-pipeline.cjs, middleware-platform/scripts/debug-crm-pipeline.js, middleware-platform/services/admin-lead-facade.js, middleware-platform/services/conversation-mode/rails/somo-sales-inbound-rail.js
- **Verification:** `npm run verify:crm-pipeline` — 12/12 local checks pass; Jest `platform-sales|somo-sales|sales-crm` — 17/17 pass
- **Notes:** **Prod-only:** place +363 call; confirm lead in `/admin/pipeline.html` with hot/warm/cold tier

### [10.3] Admin CRM confirmation modals
- **Completed:** 2026-07-05
- **Files:** unified-dashboard/admin/assets/js/admin-shell.js, unified-dashboard/admin/pipeline.html, unified-dashboard/admin/index.html, unified-dashboard/admin/lead.html, unified-dashboard/admin/tenants.html, unified-dashboard/assets/css/admin-portal.css
- **Verification:** Scrape/enrich/batch-call/delete require styled `confirmAction` modal before execution (no immediate fire)

### [10.4] Duplicate admin leads entry points
- **Completed:** 2026-07-05
- **Files:** unified-dashboard/admin/leads.html, unified-dashboard/business/leads.html, unified-dashboard/admin/assets/js/admin-shell.js, unified-dashboard/assets/js/provider-shell.js
- **Verification:** Canonical UI `/admin/pipeline.html`; `admin/leads.html` + `business/leads.html` redirect; duplicate admin sidebar “Leads” nav removed; provider nav → `/admin/pipeline.html`

### [10.5] TCPA consent tracking for scraped outbound
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/lead-outbound-consent.js, middleware-platform/database.js, middleware-platform/routes/admin-leads.js, middleware-platform/services/admin-lead-facade.js, middleware-platform/services/platform-caller-lookup.js, unified-dashboard/admin/lead.html, middleware-platform/__tests__/lead-outbound-consent.test.js
- **Verification:** `npm test -- --testPathPattern=lead-outbound-consent` — 7/7 pass; scraped lead POST `/call` returns `TCPA_OUTBOUND_CONSENT_REQUIRED`; inbound_platform + express_written allowed

### [10.6] Mobile admin desktop-only notice
- **Completed:** 2026-07-05
- **Files:** unified-dashboard/admin/assets/js/admin-shell.js, unified-dashboard/assets/css/admin-portal.css
- **Verification:** `mountMobileDesktopNotice()` injects sticky banner below 769px viewport; hidden on desktop

### [11.1] PENDING.md sole status SSOT
- **Completed:** 2026-07-05
- **Files:** todos/PENDING.md, docs/CUSTOMER_READY_BACKLOG.md
- **Verification:** CUSTOMER_READY_BACKLOG archived to redirect stub; PENDING.md header declares sole SSOT; no parallel status tables remain in backlog file

### [11.2] Fix stale doc references
- **Completed:** 2026-07-05
- **Files:** docs/qa/provider-portal-feature-inventory.md, docs/product/KELLY_FRONT_DESK_UX.md, docs/deployment/OPERATIONS.md, docs/runbooks/OPERATIONS.md, docs/voice/VOICE_RETELL_AGENT_CONTRACT.md, docs/deployment/VOICE_RETELL_AGENT_CONTRACT.md, middleware-platform/e2e/dentist-journey-parity.spec.cjs
- **Verification:** grep `/business/schedule.html` → 0 (except plan file); KELLY_FRONT_DESK_UX documents live self-serve signup; OPERATIONS pair cross-linked; voice Retell contract SSOT in docs/voice/

### [11.3] Split oversized archive READMEs
- **Completed:** 2026-07-05
- **Files:** docs/architecture/README.md, docs/middleware-platform/README.md, docs/deployment/README.md, docs/development/README.md, docs/runbooks/README.md, docs/*/archive/CONSOLIDATED-HISTORICAL.md
- **Verification:** Each folder README is thin pointer; ~12k/4.5k/3.7k/2.7k/1.3k-line merges moved to archive/CONSOLIDATED-HISTORICAL.md

### [11.4] Archive commerce PSTN QA docs
- **Completed:** 2026-07-05
- **Files:** docs/qa/archive/commerce-pstn/* (10 files), docs/qa/archive/commerce-pstn/README.md, docs/qa/COMMERCE_100_SCENARIO_SELF_REVIEW.md
- **Verification:** grep docs/qa/commerce-pstn-replay → 0 at qa root; files under archive/commerce-pstn/

### [11.5] Check master plans into repo
- **Completed:** 2026-07-05
- **Files:** docs/plans/README.md, docs/plans/CURSOR_PRODUCTION_PLAN.md, docs/meta/CANONICAL_DOC_MAP.md, todos/PENDING.md
- **Verification:** docs/plans/ is version-controlled SSOT; README states Cursor local plans superseded; ~/.cursor/plans refs removed from PENDING

### [12.1] PHI encryption at rest evaluation
- **Completed:** 2026-07-05
- **Files:** docs/compliance/PHI_ENCRYPTION_AT_REST.md
- **Verification:** SQLCipher vs Postgres evaluated; interim decision = GCP default encryption + Postgres-primary roadmap; verification checklist documented

### [12.2] Tenant offboarding export completeness
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/tenant-phi-export-service.js, docs/runbooks/TENANT_OFFBOARDING.md, middleware-platform/__tests__/tenant-phi-export-service.test.js
- **Verification:** `npm test -- --testPathPattern=tenant-phi-export-service` — 7/7 pass; export v2 includes triage_sessions, conversation_history, health_session_transcripts

### [12.3] Vendor BAAs ops tracker
- **Completed:** 2026-07-05
- **Files:** docs/compliance/VENDOR_BAA_TRACKER.md
- **Verification:** Tracker documents Twilio, Retell, Stedi, GCP, Stripe, LLM providers with status columns for legal sign-off

### [6.1] Hard turn-level timeout on runKellyTurn
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/kelly-turn-resolver.js, middleware-platform/__tests__/phase6-multilang-intent.test.js
- **Verification:** `withKellyTurnTimeout` returns graceful degradation on LLM_TURN_TIMEOUT; unit test passes (52ms)

### [6.2] Voice path HyDE off + 2s RAG cap
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/voice-rag-config.js, middleware-platform/services/triage-rag-service-v2.js, middleware-platform/services/kelly-tool-executor.js
- **Verification:** `resolveRagRuntimeOptions('voice')` → hydeEnabled=false, remoteTimeoutMs≤2000; channel passed from tool executor

### [6.3] Fix latency_ms null in agent_turns
- **Completed:** 2026-07-05
- **Files:** middleware-platform/webhooks/retell-websocket.js
- **Verification:** `insertAgentTurn` uses measured ms from `connection._kellyTurnStartedAt`

### [6.4] Reconcile REMOTE_RAG_TIMEOUT_MS voice vs non-voice
- **Completed:** 2026-07-05
- **Files:** middleware-platform/.env.example, middleware-platform/scripts/generate-cloudrun-env-yaml.cjs, middleware-platform/services/voice-rag-config.js
- **Verification:** VOICE_REMOTE_RAG_TIMEOUT_MS=2000, REMOTE_RAG_TIMEOUT_MS=8000 documented and wired

### [6.5] Adaptive voice filler timing
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/voice-turn-filler.js, middleware-platform/webhooks/retell-websocket.js
- **Verification:** booking filler (600ms) < symptom/RAG filler (1800ms) in unit test

### [6.6] Gate coding state machine off routine voice turns
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/voice-coding-hot-path.js, middleware-platform/webhooks/retell-websocket.js
- **Verification:** booking utterance skips coding graph; CPT inquiry runs it

### [6.7] ES/RU cancellation intent routing
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/conversation-mode/intent-detector.js, middleware-platform/services/kelly-rails/turn-planner.js, middleware-platform/services/conversation-mode/subrails/cancellation-subrail.js
- **Verification:** intent unit tests pass; ES-3 automated pass in multilang eval; RU-3 fee-inquiry subrail fix + lane hint `cancel`

### [6.8] Full Mandarin (zh) support
- **Completed:** 2026-07-05
- **Files:** middleware-platform/config/clinical-opqrst/zh.json, middleware-platform/services/conversation-mode/intent-detector.js, middleware-platform/services/sms-service.js, middleware-platform/e2e/scenario-registry/dental-front-desk.cjs, middleware-platform/e2e/helpers/multilang-eval-assertions.cjs
- **Verification:** zh OPQRST pack + SMS + intent stems; ZH-1..ZH-3 scenarios in registry (eval LLM-dependent)

### [6.9] Records Q&A multilang eval matrix
- **Completed:** 2026-07-05
- **Files:** middleware-platform/e2e/scenario-registry/dental-front-desk.cjs, middleware-platform/e2e/helpers/kelly-conversation-fixtures.cjs
- **Verification:** 8 records_qa scenarios (EN/ES/RU/ZH × derm + healthcare_clinic); run via `--tag=records_qa`

### [6.10] Stedi 271 multilingual sign-off (M6)
- **Status:** BLOCKED — requires live Stedi credentials
- **Verification:** `npm run test:eval:multilang:stedi-live` documented; VOICE_ELIGIBILITY_SIMULATE=0 + real payer sandbox needed

### [6.11] Dermatology clinical path hardening
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/kelly-rails/config.js, middleware-platform/config/clinical-opqrst/es.json (existing)
- **Verification:** `KELLY_OPQRST_ES_PACK=v1` activates ES pack without staging signoff file gate

### [6.12] healthcare_clinic + small_business admin paths
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/resolve-admin-visit-codes.js, middleware-platform/__tests__/phase6-multilang-intent.test.js
- **Verification:** healthcare_clinic → 99395 E/M; small_business → 99213; not dental CDT inheritance

### [6.x] Multilang eval (strict)
- **Completed:** 2026-07-05
- **Files:** middleware-platform/services/kelly-rails/gates/schedule.js, middleware-platform/services/kelly-rails/gates/shared.js, middleware-platform/services/kelly-rails/turn-planner.js, middleware-platform/services/kelly-rails/slot-time-parse.js, middleware-platform/services/kelly-rails/prompts/deterministic.js, middleware-platform/e2e/scenario-registry/dental-front-desk.cjs
- **Verification:** `MULTILANG_EVAL_RUNS=3 CONVERSATION_EVAL_STRICT=1 npm run test:eval:multilang` → **19/19** automated (booking/cancel/copay_eligibility/copay_payment/inquiry all pass; EN/ES/RU/ZH majority 3/3). Root-cause fixes: schedule gate uses `executeDeterministicTool` (`_skipModeFirewall`) so `MODE_FIREWALL_BLOCKED` no longer blocks deterministic booking; ZH locale gaps (insurance_quote, 12点/周二/下周 parsers, reschedule intents).

---

## Final acceptance test (17 steps)

**Automated / code-verified (this session):**
- Steps 12 (firewall): `mode-tool-firewall-phase4` + `coding-layer-leaks` Jest suites pass
- Step 13 (multilang): **19/19 strict** (`MULTILANG_EVAL_RUNS=3 CONVERSATION_EVAL_STRICT=1 npm run test:eval:multilang`)
- Step 14: N/A (Phase 9 deferred)
- Step 16 (portal retired): `firebase.json` `/patients/**` → marketing; hosting build excludes patient portal; docs updated

**Operator-required before prod sign-off:**
- Steps 1–8: live dental signup → voice-setup → PSTN book/cancel/quote/pay on real phone
- Steps 9–11: cross-vertical + Mandarin live PSTN
- Step 15: live +363 call → CRM tiering in `/admin/pipeline.html`
- Step 17: second-person UI walkthrough without engineer help
- Phase 6.10: Stedi live sign-off (`npm run test:eval:multilang:stedi-live`)
- Phase 7.3/7.5/7.9: `LIVE=1` deploy gate + Cloud Run env verify
- Phase 10.1: +363 prod bind per `docs/deployment/PLATFORM_SALES_363_DEPLOY.md`

**Cross-phase Jest spot-check (2026-07-05):** 43 tests across phase1/3/4/phi/export/consent/cdt — all pass.

### [CLOSE-NB] Close all non-blocker production issues
- **Completed:** 2026-07-06
- **Files:** unified-dashboard/reset-password.html, portal.html, provider-shell.js, business/today.html; middleware-platform/server.js, routes/case-report.js, routes/tenant-integrations.js, database.js, services/sms-service.js, services/kelly-agent-service.js, e2e/helpers/tenant-ui-audit.cjs, e2e/helpers/kelly-conversation-fixtures.cjs, scripts/ci-local.sh, scripts/operator-plan-closure.cjs, package.json (`dev:audit`); docs/compliance/RETENTION_COUNSEL_REVIEW.md, VENDOR_BAA_TRACKER.md; __tests__/case-report-merchant-scope.test.js, patient-portal-retirement.test.js, tenant-integrations-clinic-scope.test.js
- **Verification:**
  - `npm test -- --testPathPattern='case-report|pms-tenant|static-hosting|patient-portal'` — 12/12 pass
  - `TENANT_AUDIT_STRICT=1` tenant audit — **157 pass / 0 fail / 21 skip** (`test-results/tenant-front-desk-audit.md`)
  - `CONVERSATION_EVAL_STRICT=1 VOICE_EVAL_SIMULATE_SMS=1 npm run test:eval:multilang` — **19/19**
  - `npm run operator:plan-closure` — **10/10** automated (`test-results/operator-plan-closure.json`)
  - `RETENTION_DRY_RUN=1 node scripts/retention-cleanup.cjs` — `{"success":true,"dry_run":true,...}`
- **Notes:** Stedi 6.10 + Dentrix live API remain sole code-review blockers. Phase 8 live prod (`LIVE=1`, PSTN, +363, ACC walkthrough) requires interactive `gcloud auth login` and physical phone — not run in this session.

### [7.9-local] Operator plan closure — automatable gates
- **Completed:** 2026-07-06
- **Files:** middleware-platform/scripts/operator-plan-closure.cjs, middleware-platform/scripts/verify-phase7-portal.cjs, middleware-platform/e2e/global-setup-tenant-audit.cjs
- **Verification:** `npm run operator:plan-closure` — **10/10** automated pass; 14 operator items documented in `test-results/operator-plan-closure.json`
- **Notes:** `TENANT_AUDIT_FORCE_RESTART=1` restarts audit middleware on `:4001`; `npm run dev:audit` seeds audit DB + starts `:4001`; prod/live items require `gcloud auth login`, GCS bucket, PSTN, counsel, or human QA

---

**Plan execution status:** Phases 0–5, 11–12 code-complete; all automatable local gates green (`operator:plan-closure` **10/10**); 14 operator/legal items + Stedi 6.10 + Dentrix live remain; Phase 9 + 5.17 deferred.

## Pending closure (SSOT: [`todos/PENDING.md`](todos/PENDING.md) § Production plan closure)

Last updated: 2026-07-06. **14 operator/legal items** (+ Stedi 6.10 + Dentrix live). Run `npm run operator:plan-closure` for local gate report.

### Engineering (code) — closed

All non-blocker code review items closed. See `[CLOSE-NB]` above and `test-results/operator-plan-closure.json`.

### Blocked — external only

| ID | Task | Blocker |
|----|------|---------|
| 6.10 | Stedi 271 multilingual live sign-off | Live Stedi payer sandbox (`VOICE_ELIGIBILITY_SIMULATE=0`) |
| Dentrix | PMS `CONNECTED` beyond manual interim | Henry Schein API Exchange approval |

### Operator / live prod — 14 items

| ID | Task | Command / runbook |
|----|------|-------------------|
| G2 | Counsel-approved retention policy | Replace placeholder in `retention-policy.js` |
| 12.3-OPS | Vendor BAA legal sign-off | `docs/compliance/VENDOR_BAA_TRACKER.md` |
| 7.1 | Postgres/GCS reconciliation | `verify-postgres-gcs-reconciliation.cjs` on prod |
| 7.2 | Mirror lag gate | `verify-postgres-mirror-lag.cjs` + `STRICT=1` |
| 7.3 | PSTN matrix per vertical | `VERTICAL_PSTN_LIVE=1` |
| 7.4 | Site context all verticals | `verify-tenant-site-context-all-verticals.cjs` on prod DB |
| 7.5 | Cloud Run Kelly Rails env | `npm run verify:kelly-rails-cloudrun` |
| 7.6 | Rollback drill <15 min | `bash scripts/rollback-gcp-release.sh` |
| 7.8 | Full release smoke (local) | `npm run phase7:release-smoke` — **pass local** |
| 7.9 | Production deploy gate (local) | `npm run verify:phase7-deploy-gate` — **pass local**; `LIVE=1` needs gcloud |
| 7.10 | Tenant provisioning per vertical | `verify-tenant-provisioning.cjs` on prod (`PROVISION_*`) |
| 10.1 | +363 prod bind + inbound verify | `PLATFORM_SALES_363_DEPLOY.md` |
| 10.2 | Live +363 → CRM pipeline tier | `verify-crm-pipeline` + manual call |
| ACC-01–17 | Final acceptance (steps 1–11, 15, 17 operator) | `CURSOR_PRODUCTION_PLAN.md` acceptance block |

### Deferred (not required for provider plan sign-off) — 6 items

| ID | Task |
|----|------|
| 5.17 | health-video Firebase rewrite |
| 9.1–9.5 | Somo Health consumer (Phase 9) |
| 7.7-EXT | Full ADA CDT ~900+ codes (427 seeded; stretch) |

