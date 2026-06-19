# Voice remediation train (R-01–R-13)

**Last updated:** 2026-06-18  
**Engineering status:** R-01–R-08, R-10, R-12 eng complete; operator gates R-09, R-11 remain; R-06-4 held until T-001 fails.

**Related:** [PENDING.md](./PENDING.md) · [VOICE-SITE-ESC-EPIC.md](./VOICE-SITE-ESC-EPIC.md) · [PLATFORM-VOICE-ROUTING.md](./PLATFORM-VOICE-ROUTING.md) · [ADR-CROSS-CHANNEL-SESSION-PRECEDENCE](../docs/voice/ADR-CROSS-CHANNEL-SESSION-PRECEDENCE.md) · [DEFERRED-A7-LOCATION-ID](../docs/voice/DEFERRED-A7-LOCATION-ID.md)

**Hard gates:**
- No prod tenant escalation until **T-001** passes
- No migration **074/076** until **R-07** backfill + `verify-tenant-columns-null-free.cjs` exit 0
- No tenant outbound go-live until **R-10** operator smoke on staging

---

## R-01 — P0: migration 072 upsert (#18, #19)

| ID | Owner | Status | Acceptance |
|----|-------|--------|------------|
| R-01-1 | eng | **done** | `ON CONFLICT(id)`; default `id=merchantId`, clinic `id=merchantId:clinicId` |
| R-01-2 | eng | **done** | Signature `upsertVoiceAgentSettings(merchantId, settings, customerId, { clinicId })` |
| R-01-2a | eng | **done** | API route accepts `clinic_id`; provider dashboard saves per-clinic settings |
| R-01-3 | eng | **done** | Postgres path matches SQLite `id` strategy |
| R-01-4 | eng | **done** | `voice-settings-clinic.test.js` upsert roundtrip |
| R-01-5 | eng | **done** | `saas-tenant-provision.test.js` green |

---

## R-02 — P0: voice-call-context.js (#1–6)

| ID | Owner | Status | Acceptance |
|----|-------|--------|------------|
| R-02-1 | eng | **done** | `buildVoiceCallContext`, `canRunKelly`, `canPrepopulatePatient`, `canUseClinicId`, `effectiveClinicId`, `toRetellMetadata` |
| R-02-2 | eng | **done** | Ingress: no unconditional `clinicId = siteCtx.clinic_id \|\| clinicId` |
| R-02-3 | eng | **done** | Patient pre-pop gated on `canPrepopulatePatient()` |
| R-02-4 | eng | **done** | `effectiveClinicId()` passed to `loadProviderVoiceRuntime` (ingress + WS) |
| R-02-5 | eng | **done** | `evaluateIdentityAdmission` requires `verified \| not_required` site status |
| R-02-6 | eng | **done** | `seedModeAtCallStart` fail_closed when tenant + ambiguous/missing site |
| R-02-7 | eng | **done** | `toRetellMetadata`: `clinic_id` only when verified |
| R-02-8 | eng | **done** | DID-first; LX-12 reconnect prefers DID over stale metadata |
| R-02-9 | eng | **done** | WS `connection.voiceContext`; Kelly blocked when `!canRunKelly()` / `kelly_admission_blocked` |

---

## R-03 — P0: phone-global identity (#7–10)

| ID | Owner | Status | Acceptance |
|----|-------|--------|------------|
| R-03-1 | eng | **done** | `getFHIRPatientByPhone` + `requireClinicScope` for voice |
| R-03-2 | eng | **done** | `findFHIRPatientForVoice({ phone, clinicId, customerId })` |
| R-03-3 | eng | **done** | Voice FHIR callers scoped; `audit-voice-fhir-callers.cjs` in CI |
| R-03-4 | eng | **done** | `getOrchestrateSessionByCallerPhone(phone, { clinicId, customerId })` |
| R-03-5 | eng | **done** | Voice: no resume without verified clinicId |
| R-03-6 | eng | **done** | Patient_id resume adds `AND clinic_id = ?` |
| R-03-7 | eng | **done** | Migration **077** `fhir_patients.clinic_id_source`; ambiguous backfill flagged |

---

## R-04 — P0/P1: tenant on writes (#11–17, #27 writes)

| ID | Owner | Status | Acceptance |
|----|-------|--------|------------|
| R-04-1 | eng | **done** | `tenant-write-context.js` |
| R-04-2 | eng | **done** | `persistRailsSessionState` backfill-on-write from `call_site_context` |
| R-04-3 | eng | **done** | `createCaseRecord` tenant cols; gate voice if unverified |
| R-04-4 | eng | **done** | `session-state-store.js` tenant on envelope |
| R-04-5 | eng | **done** | `upsertTriageSession` tenant cols + site backfill |
| R-04-6 | eng | **done** | Postgres mirror tenant cols |
| R-04-7 | eng | **done** | `upsertOrchestrateSession` overwrite clinic on `force_clinic_sync` |
| R-04-8 | eng | **done** | Migration **075**: `handoff_escalations.clinic_id`, `customer_id` |

---

## R-05 — P1: meta_kv demotion (#28–30)

| ID | Owner | Status | Acceptance |
|----|-------|--------|------------|
| R-05-1 | eng | **done** | Remove `syncMetaFromFlags` meta_kv writes |
| R-05-2 | eng | **done** | `mirrorMetaFromPayload` commerce allowlist only |
| R-05-3 | eng | **done** | Checkout through `meta-kv-policy.js` |
| R-05-4 | eng | **done** | `hydrate.js` reads orchestration from projection |
| R-05-5 | eng | **done** | CI runs `META_KV_POLICY_STRICT=1` |

---

## R-06 — P0: escalation (#22–23, #25–26; #24 done)

| ID | Owner | Status | Acceptance |
|----|-------|--------|------------|
| R-06-1 | eng | **done** | Gate `transfer_call` on verified site |
| R-06-2 | eng | **done** | `resolvePstnTarget` ignores clinic PSTN when not verified |
| R-06-3 | operator | open | **T-001** staging transfer ring |
| R-06-4 | eng | **held** | REST transfer fallback only if T-001 fails |
| R-06-5 | eng | **done** | Verify WS vs Retell telephony config |
| R-06-7 | eng | **done** | PSTN ladder + customer support phone |
| R-06-8 | eng | **done** | Narrow `not_required` for operator outbound scheduling |

**#24 emergency-safety.js:** Done — out of scope.

---

## R-07 — P0/P1: backfill + NOT NULL (#11, #20)

| ID | Owner | Status | Acceptance |
|----|-------|--------|------------|
| R-07-1 | eng | **done** | Backfill script: 5 sources (site, voice log, orchestrate, events, case_records) |
| R-07-2 | operator | open | `verify-tenant-columns-null-free.cjs` exit 0 on staging post-deploy |
| R-07-3 | eng | **partial** | Deploy migration 074 after verify green on target DB |
| R-07-4 | eng | **partial** | Migration **076** NOT NULL after 074 |
| R-07-5 | eng | **done** | OPERATIONS runbook backfill → verify → 074 → 076 |

---

## R-08 — P1/P2: CI + docs (#21, #31–33)

| ID | Owner | Status | Acceptance |
|----|-------|--------|------------|
| R-08-1 | eng | **done** | No-op migration **073** |
| R-08-2 | eng | **done** | Block `ALLOW_DEV_CLINIC_FALLBACK` in staging/prod |
| R-08-3 | eng | **done** | Fix `kelly-rails-router.test.js` |
| R-08-4 | eng | **done** | Canonical DB path `var/db/` assert |
| R-08-5 | eng | **done** | `voice-tenant-contract-smoke.cjs` in ci-local |
| R-08-6 | eng | **done** | Update VOICE_ROUTING_ARCHITECTURE.md |
| R-08-7 | eng | **done** | Tracker honesty |

---

## R-09 — P1: Spanish Phase C (C-P0-01–07, CR-025)

| ID | Owner | Status | Acceptance |
|----|-------|--------|------------|
| R-09-1 | clinical | open | C-P0-01 OPQRST review packet + ES copy draft |
| R-09-2 | clinical | open | `OPQRST_ES_SIGNOFF_<date>.md` |
| R-09-3 | eng | open | Populate `es.json` from approved text |
| R-09-4 | operator | open | ES cohort 10+5+5 |
| R-09-5 | operator | open | Demo dry-run EN + ES |
| R-09-6 | eng | open | Phase C EXECUTION complete |
| R-09-7 | eng | open | Staging `KELLY_OPQRST_ES_PACK=v1`; prod ES gated on sign-off |
| R-09-8 | operator | open | CR-025: `sandbox-spanish-green` 3× 14/14 |

**Prep:** [OPQRST_ES_SIGNOFF_TEMPLATE.md](../docs/clinical/OPQRST_ES_SIGNOFF_TEMPLATE.md)

**Gate:** No `KELLY_RAILS_ES_ENABLED=1` in prod until R-09-2 + R-09-4.

---

## R-10 — P1: outbound safety (LX-7, LX-11)

| ID | Owner | Status | Acceptance |
|----|-------|--------|------------|
| R-10-1 | eng | **done** | Enforce `outbound_quiet_hours` at call initiation |
| R-10-2 | eng | **done** | Default quiet hours when unset |
| R-10-3 | eng | **done** | Retry cap per lead/campaign |
| R-10-4 | eng | **done** | Persist attempt count on outbound log |
| R-10-5 | eng | **partial** | Unit done; operator-outbound-smoke on staging remains |

---

## R-11 — P0/P1: live verify (PD-4, CR-029–037, T-001)

See [VOICE_REMEDIATION_OPERATOR_GATES.md](../docs/runbooks/VOICE_REMEDIATION_OPERATOR_GATES.md).  
**Prep:** `voice-routing-matrix-live.cjs --checklist`

---

## R-12 — P1/P2: product gaps

| ID | Owner | Status | Acceptance |
|----|-------|--------|------------|
| R-12-1 | eng | **done** | CR-027b: lane-entry gate before booking subrail |
| R-12-2 | eng | **done** | CR-026b: `seed:prompt-profiles` backfill |
| R-12-3 | eng | **done** | LX-12: WS reconnect contract tests |
| R-12-4 | eng | **done** | B6: cross-channel session precedence ADR |
| R-12-5 | eng | **done** | A7: deferred stub for `location_id` |
| R-12-6 | operator | open | LX-3: verify demo `end_call` post-call email live |

---

## R-13 — Doc sync

| ID | Status |
|----|--------|
| R-13-1 | **done** — #23 WS implemented; T-001 unverified; REST conditional |
| R-13-2 | **done** — #24 Done |
| R-13-3 | **done** — #27 writes landed |
| R-13-4 | **done** — CUSTOMER_READY_BACKLOG synced |
| R-13-5 | **done** — Links from PENDING + VOICE-SITE-ESC-EPIC |

---

## Issue cross-map (#1–33)

| # | PR | Status |
|---|-----|--------|
| 1–6 | R-02 | **done** |
| 7–10 | R-03, R-07 | **done** (staging verify operator) |
| 11–17 | R-04, R-07 | **done** |
| 18–19 | R-01 | **done** |
| 20 | R-07 | partial (074/076 after verify) |
| 21 | R-08 | **done** |
| 22–23, 25–26 | R-06 | partial (#23 WS done; T-001 operator) |
| 24 | — | **done** |
| 27 schema | — | **done** (070/071) |
| 27 writes | R-04 | **done** |
| 28–30 | R-05 | **done** |
| 31–33 | R-08 | **done** |
