# testing — consolidated documentation
> Last reviewed: 2026-05-25

**Last Updated:** 2026-05-30


**Canonical map:** [CANONICAL_DOC_MAP.md](../meta/CANONICAL_DOC_MAP.md) — read here first to avoid duplicating documentation.

## Existing Documentation Body


## Table of contents

- [Production Playwright suites (`PROD_PLAYWRIGHT_SUITES.md`)](./PROD_PLAYWRIGHT_SUITES.md)
- [Agentic checkout — accessibility smoke (manual) (`AGENTIC_CHECKOUT_A11Y_SMOKE.md`)](#agentic-checkout-a11y-smoke)
- [Agentic checkout — manual E2E checklist (staging) (`AGENTIC_CHECKOUT_E2E_CHECKLIST.md`)](#agentic-checkout-e2e-checklist)
- [Browser E2E status (`E2E_STATUS.md`)](#e2e-status)
- [Testing Documentation (`README.md`)](#readme)
- [Scan Results UI Audit Evidence (`SCAN_RESULTS_UI_AUDIT_EVIDENCE.md`)](#scan-results-ui-audit-evidence)
- [Staging verification — commerce quote parity and chat → pay (`STAGING_PRODUCT_VERIFICATION.md`)](#staging-product-verification)
- [Staging diagnostic — signup, Twilio, agent, calls (`STAGING_DIAGNOSTIC_RUNBOOK.md`)](#staging-diagnostic-runbook)
- [TELEMEDICINE_E2E (`TELEMEDICINE_E2E.md`)](#telemedicine-e2e)
- [Phase 10 Task 63 — Transcript-only path: end-to-end test (`TRANSCRIPT_ONLY_E2E.md`)](#transcript-only-e2e)
---

## Introduction

Browse by anchor above. Each section notes the former file path.

**Middleware unit tests (Jest):** [`middleware-platform/__tests__/README.md`](../../middleware-platform/__tests__/README.md) — what `npm test` runs in `middleware-platform`, Node harnesses excluded from Jest, Playwright vs `test:eval-engine`.

**Medical coding accuracy eval:** from `middleware-platform/`, `SKIP_STARTUP_MIGRATIONS=1 RAG_API_URL=disabled EVAL_USE_SEMANTIC=false npm run eval:coding` — see [docs/Medical Coding/OPERATIONS.md](../Medical%20Coding/OPERATIONS.md).

---

<a id="agentic-checkout-a11y-smoke"></a>

## Agentic checkout — accessibility smoke (manual)


Use **Chrome DevTools** → device toolbar for width; **Reduce motion**: macOS System Settings → Accessibility → Display → Reduce motion (or DevTools rendering).

## Web (`unified-dashboard/patients/checkout-chat.html`)

| Check | 375px | 320px |
|-------|-------|-------|
| **Skip link** “Skip to chat” appears on focus; focus moves to `#cc-main` | ☐ | ☐ |
| No horizontal scroll on main column | ☐ | ☐ |
| Composer + primary actions reachable without overlap | ☐ | ☐ |
| Focus visible on Send, Switch, Pay, footer links | ☐ | ☐ |
| Payment bubble verification controls are keyboard reachable in order: Send code → code input → Verify | ☐ | ☐ |
| **Pay securely** remains disabled until verification succeeds | ☐ | ☐ |
| Price updates announced (`aria-live` on `#productPrice`) | ☐ | ☐ |
| New chat messages announced (`aria-live` on `#chatLog`) | ☐ | ☐ |
| With **Reduce motion**: shimmer / typing dots / quote pulse disabled | ☐ | ☐ |

## Native (`patient-app`)

- Dynamic type: verify header + Pay hero do not clip on small heights.
- VoiceOver / TalkBack: header, Pay, Send, Switch row labels read sensibly.


---

<a id="agentic-checkout-e2e-checklist"></a>

## Agentic checkout — manual E2E checklist (staging)


Use this when validating **landing → login → checkout-chat → quote → pay → success** end-to-end. **CI** runs static checks (including `npm run verify:agentic-checkout` at the repo root) and middleware Jest. **Browser E2E** uses **Playwright** under `middleware-platform/e2e/` (there is no Cypress tree). See [`docs/deployment/README.md`](../deployment/README.md) for CI truth.

## Prerequisites

- Middleware running with Stripe test keys and seed products (e.g. demo serums).
- Patient portal reachable at `REACT_APP_PATIENT_PORTAL_PREFIX` (default `/unified-dashboard/patients`).
- Somo marketing landing (`somo-landing`) built with `VITE_API_BASE` (empty = same-origin). Legacy Skin & Care CRA tests used `_archive/littlelab-landing` + `REACT_APP_API_BASE`.

## Flow

1. **Landing — Ask (chat-first)**  
   Open the Skin & Care marketing landing → product card → **Ask about this product** → login → lands on `checkout-chat.html` with `product_id` / `provider_id` in the query string.

2. **Quote**  
   Confirm header shows server price; in devtools Network, `POST /api/public/commerce/quote` returns `200` with `quote_id` and `amount`.

3. **Email verification gate (in-chat)**  
   In the payment bubble:
   - Enter email → click **Send code** (`POST /api/public/commerce/email/send-code`, `200`)
   - Enter 6-digit code → click **Verify** (`POST /api/public/commerce/email/verify-code`, `200`)
   - Confirm UI shows **Email verified. You can pay securely now.**
   - Confirm **Pay securely** stays disabled until verification succeeds.

4. **Checkout start**  
   After verification, continue payment. `POST /api/public/commerce/cart/checkout` returns `success` with Stripe client secret + payment intent (or fallback checkout/start path).

5. **Stripe**  
   Complete test card payment; redirect returns to success URL (wallet / payment-success as configured).

6. **Success**  
   - **Visit checkout:** `payment-success.html?appointment_id=…` — pill settles; async vs sync copy matches `visit_mode` from `/api/patient/appointments`.  
   - **Retail only:** open `payment-success.html` without `appointment_id` — retail “Your order” block appears.

## Feature flag

- Set `REACT_APP_CHAT_FIRST_CHECKOUT=false` on the landing build → **Ask** link hidden; bag **Buy** still works.

## Learn vs checkout URL modes (`checkout-chat.html`)

- **Learn / explore:** `intent=learn_more` and `phase3=1` → body `mode-learn`; checkout stepper/cart emphasis stays off until the user converts.
- **Checkout-first:** `intent=checkout_chat` (and optional `source=landing`) → body `mode-checkout`; cart + stepper visible.

**Automated (checkout-related):** run repo-root `npm run verify:agentic-checkout` (static contract checks). There is no dedicated checkout Playwright suite yet; add one under `middleware-platform/e2e/` when browser coverage is needed.

## Copy source of truth

- Default strings live in `unified-dashboard/patients/checkout-chat.html` (see `DEFAULT_KELLY_COPY` constant name in source).
- Overrides: `unified-dashboard/copy/checkout-kelly.json` (filename is legacy; keep keys in sync when changing UI).

## Cross-device manual matrix (spot-check)

| Surface | Viewport | Check |
|---------|----------|--------|
| iOS Safari | 390×844 | Learn + checkout flows; Stripe Element scroll |
| Android Chrome | 360×800 | Same |
| Desktop Chrome | 1280×720 | Keyboard: Tab to skip link → main → composer |

## Regression spots

- **Timezone:** booking calendar (`schedule.html`) uses `isoDateInTz` + civil `YYYY-MM-DD` for day cells — see `schedule-isoDateInTz.test.js`.  
- **Payable without active pending row:** unpaid visits still expose `payment_status` via FHIR extension or legacy `appointments.payment_status` (see `/api/patient/appointments` merge in `server.js`).


---

<a id="e2e-status"></a>

## Browser E2E status

**Playwright:** specs live in [`middleware-platform/e2e/`](../../middleware-platform/e2e/) (e.g. `landing-pipeline.spec.cjs`, `landing-find-provider.spec.cjs`, `prod-smoke.spec.cjs`). Config: [`middleware-platform/playwright.config.cjs`](../../middleware-platform/playwright.config.cjs) (local landing build) and [`middleware-platform/playwright.prod.config.cjs`](../../middleware-platform/playwright.prod.config.cjs) (prod).

**Common commands:** `npm run test:e2e-landing --prefix middleware-platform`, `npm run test:e2e-landing:find-provider --prefix middleware-platform`, `npm run test:prod:smoke --prefix middleware-platform`. Full matrix: [PROD_PLAYWRIGHT_SUITES.md](./PROD_PLAYWRIGHT_SUITES.md).

**Manual / staging flows:** [AGENTIC_CHECKOUT_E2E_CHECKLIST.md](./README.md#agentic-checkout-e2e-checklist), [STAGING_PRODUCT_VERIFICATION.md](./README.md#staging-product-verification).

**CI truth:** [deployment README](../deployment/README.md).


---

<a id="readme"></a>

## Testing Documentation


Test results, test suites, and testing guides.

## Automated tests

Jest suites live under `middleware-platform/__tests__/` (e.g. reasoning-map, session orchestration, security redaction). Playwright E2E specs live under `middleware-platform/e2e/`.

## Running tests

```bash
cd middleware-platform
npm test                         # jest --passWithNoTests (all __tests__)
npm run test:reasoning-map       # focused Jest suite
npm run test:session-orchestration
npm run test:e2e-landing         # build landing + Playwright project landing
npm run medicaid:smoke          # provider search HTTP smoke (requires API on :4000 by default)
```

## Related documentation

- [Architecture Voice Agent](../architecture/README.md#voice-agent-runbook) — medical coding runbook
- [LangGraph & LangSmith](../middleware-platform/README.md#langgraph-langsmith)
- [Main Docs](../README.md#readme)

---



---

<a id="scan-results-ui-audit-evidence"></a>

## Scan Results UI Audit Evidence


Date: 2026-04-15
Scope: Phase `4.1F` scan results conversion redesign

## Current-state Playwright audit

- Spec: `middleware-platform/e2e/landing-results-visual.spec.cjs`
- Command: `npm run test:e2e:results-visual --prefix middleware-platform`
- Audit notes captured:
  - Results content was visually low-emphasis vs. surrounding content.
  - Hero image needed stronger fallback behavior.
  - Decision answers were not grouped in one obvious block.

## Evidence artifacts (CI/staging)

- CI artifact bundle: `landing-results-visual`
- Representative snapshots:
  - `results-known-mobile.png`
  - `results-unknown-mobile.png`
  - `results-not-found-mobile.png`
- Guard/evidence attachment is expected via the workflow artifact upload step in `.github/workflows/ci.yml`.

## Post-redesign expected checks

- Hero card is first visual block with product image + confidence + source badges.
- Structured tiles show icon-led cards with available/deferred/unavailable states.
- Decision block answers all five user questions.
- Sticky bottom action row always exposes `Use this product`, `Fix results`, **Ask** (commerce chat), and conditional `See alternatives`.


---

<a id="staging-product-verification"></a>

## Staging verification — commerce quote parity and chat → pay


CI proves **static** contracts (syntax, Jest smoke, agentic checkout file checks, patient-app `tsc`). It does **not** prove Stripe, commerce LLM tool quotes, and manual checkout use the same amounts.

## Quote parity (commerce assistant vs manual)

1. In staging, open checkout chat with a known `product_id` / `provider_id`.
2. Use **Ask** / commerce chat to quote (or trigger `get_product_quote`) and note `quote_id` and amount from the tool / UI.
3. Call `POST /api/public/commerce/quote` with the same product/provider (or use **Pay without chat** path) and compare **amount** and **quote_id** behavior to your product rules.
4. Document any intentional divergence in `todos/pending/AGENTIC_CHECKOUT_UI_AND_BACKEND_TODOS.md`.

## Chat → quote → pay (manual / staging)

Follow **[AGENTIC_CHECKOUT_E2E_CHECKLIST.md](./README.md#agentic-checkout-e2e-checklist)** with real Stripe test keys. Record the run in your release notes when promoting builds.


---

<a id="staging-diagnostic-runbook"></a>

## Staging diagnostic — signup, Twilio, agent, calls

**Runbook:** [STAGING_DIAGNOSTIC_RUNBOOK.md](./STAGING_DIAGNOSTIC_RUNBOOK.md) — Playwright on `myskinandcare.com`, live Twilio provision smoke, post-call `voice_call_log` verification.

| npm script (`middleware-platform`) | Purpose |
|-----------------------------------|---------|
| `staging:preflight` | Phase 0 HTTP + manifest |
| `test:e2e:staging` | Shallow smoke (4 tests) |
| `test:e2e:staging-signup` | Full signup wizard S1–S8 |
| `test:e2e:staging-voice` | Agent + voice-setup (real APIs) |
| `test:e2e:staging-full` | All staging Playwright projects |
| `staging:trial-provision` | Live API trial + Twilio number |
| `staging:db-assert` | DB trial/Twilio fields |
| `staging:call-verify` | After manual inbound PSTN call |

Requires `STAGING_DB_PATH`, `TRIAL_E2E_PHONE`, and `STAGING_SMS_CODE` for full signup path. See [STAGING_SIGNOFF.md](../deployment/STAGING_SIGNOFF.md).


---

<a id="telemedicine-e2e"></a>

## TELEMEDICINE_E2E


## Telemedicine E2E Test Plan

This document defines the concrete checks to verify the telemedicine case-report feature in staging/production.

Assumptions:
- BAAs are in place for Azure, Twilio, OpenAI, and Pinecone.
- Env vars are set:
  - `REQUIRE_JWT_FOR_FHIR=1` and a strong `JWT_SECRET`
  - `CASE_REPORT_SERVICE_URL`, `CASE_REPORT_SERVICE_TOKEN`
  - Case-report service: `CASE_REPORT_VALIDATE_STRICT=1` with real `OPENAI_API_KEY`, `PINECONE_API_KEY`, `MIDDLEWARE_URL`, `MIDDLEWARE_TOKEN`
    - or `CASE_REPORT_VALIDATE_STRICT=0` for stub mode (weaker AI behaviour).

---

### Test 1 — Full flow with uploads

Goal: Book → upload → video consult → `end_session` → case report → DiagnosticReport.

1. **Book an appointment**
   - Use existing booking flow (dashboard or voice agent) to create a video appointment with a test patient.
   - Note `appointment_id`, `patient_id`, and scheduled time.

2. **Send upload link**
   - Trigger the upload link via:
     - Voice agent tool (`send_document_upload_link`), or
     - `POST /api/patient/send-upload-link` with `{ patient_id, appointment_id }`.
   - Confirm email is sent (no PHI, contains `https://.../upload?token=...`).

3. **Upload labs/images**
   - Open the `/upload?token=...` URL in a browser.
   - Upload at least:
     - 1 PDF lab result.
     - 1 image (JPEG/PNG/HEIC).
   - Confirm:
     - UI shows “Your documents have been received”.
     - `patient_uploads` row(s) exist for `patient_id`/`appointment_id` with expected `mime_type` and `size_bytes`.

4. **Run the video consult**
   - Start a LiveKit session using a room named `appt-{appointment_id}`.
   - Conduct a brief consult (enough transcript to be non-empty).
   - End the session so that `POST /api/video-consult/agent-events` receives `event='end_session'` for that room.

5. **Verify appointment completion**
   - Query DB (`appointments` table) or admin UI:
     - `status` for this `appointment_id` should be `completed`.

6. **Verify case-report job creation**
   - Check `fhir_diagnostic_reports` for a row with:
     - `patient_id`, `encounter_id` from the consult.
     - `job_id` not null.
     - `status` transitions from `pending` → `completed` (watch logs or DB).

7. **Verify callback and DiagnosticReport**
   - After the case report service runs:
     - `fhir_diagnostic_reports.status = 'completed'`.
     - `case_report_text` is non-empty.
     - `resource_data` contains a FHIR `DiagnosticReport` with:
       - `resourceType: "DiagnosticReport"`.
       - `subject.reference = "Patient/{patient_id}"`.
       - `encounter.reference = "Encounter/{encounter_id}"`.
   - Call `GET /api/encounters/{encounter_id}/diagnostic-report` with a **clinician JWT**:
     - Expect `200` and a FHIR DiagnosticReport body.

8. **Verify clinician notification**
   - Confirm clinician email and/or SMS indicating “Case report ready” (no PHI in subject/body).

9. **Verify uploads linkage**
   - Confirm `patient_uploads.encounter_id` is set on the uploaded files for this `appointment_id`.

---

### Test 2 — Transcript-only path (no uploads)

Goal: Ensure transcript-only guard works and produces a transcript-only DiagnosticReport.

1. **Book an appointment** (same as Test 1, but **do not** send an upload link or upload any files).

2. **Run the video consult**
   - Start LiveKit room `appt-{appointment_id}`.
   - Generate a short but non-empty transcript.
   - End the session.

3. **Verify appointment completion and job creation**
   - `appointments.status = 'completed'` for this `appointment_id`.
   - `fhir_diagnostic_reports` has a `pending` row for the new `encounter_id`.

4. **Verify case report content**
   - After callback, call:
     - `GET /api/encounters/{encounter_id}/diagnostic-report` (clinician JWT).
   - Inspect `case_report_text`:
     - Must start with `# TRANSCRIPT-ONLY REPORT`.
     - Must *not* mention labs or imaging findings (no fake values, no references to uploaded files).

5. **Verify Layer 1 guard behaviour**
   - For this encounter:
     - `patient_uploads` should have **no** rows with this `encounter_id`.
   - Confirm logs show either:
     - A transcript-only path taken, or
     - No errors from Layer 1/4.

---

### Test 3 — Auth and token issuance

1. **Clinician JWT**
   - Call `POST /api/auth/clinician-token` with valid clinician credentials.
   - Use returned `token` to:
     - Call `GET /api/encounters/{encounter_id}/diagnostic-report` — expect `200`.
     - Call with an invalid/expired token — expect `401/403`.

2. **Patient JWT**
   - Complete `/api/patient/verify/send` → `/verify/confirm` flow.
   - Call `POST /api/auth/patient-token` with `{ email, code }`.
   - Use returned `token` to:
     - Call `GET /api/patients/{patient_id}/my-records` — expect `200` and only this patient’s reports.
     - Call `GET /api/patients/{other_patient_id}/my-records` — expect `403`.

3. **Case-report service auth**
   - With wrong `CASE_REPORT_SERVICE_TOKEN`:
     - `POST {CASE_REPORT_SERVICE_URL}/report` should return `401`.
   - With correct token:
     - The request is accepted and returns `202 { job_id, status: "queued" }`.

---

### Test 4 — Reminder scheduler sanity

1. Create a few test appointments:
   - One ~24h in the future (with email).
   - One ~1h in the future (with email).

2. Confirm:
   - Reminder scheduler logs show each appointment once in the respective window.
   - `reminder_24h_sent` and `reminder_sent` flags flip to 1 after emails go out.
   - No full-table scans in DB logs (queries should be index-backed).



---

<a id="transcript-only-e2e"></a>

## Phase 10 Task 63 — Transcript-only path: end-to-end test



Verify that when a patient completes a consult with **no document uploads**, the DiagnosticReport is created with the **TRANSCRIPT-ONLY REPORT** header and **no hallucinated lab/imaging findings**.

## Prerequisites

- Middleware running with `CASE_REPORT_SERVICE_URL` and `CASE_REPORT_SERVICE_TOKEN` set
- Case report service running (Phase 6)
- JWT auth optional for local test

## Manual test steps

1. **Book appointment** (voice or dashboard) for a test patient. Do **not** send upload link or upload any documents.
2. **Complete the consult** (e.g. end video session so that `store_fhir` runs and `trigger_case_report` fires).
3. **Wait** for case report callback (or run case report service with transcript-only input).
4. **Verify**:
   - `fhir_diagnostic_reports` has a row for that encounter with `status = 'completed'`.
   - `case_report_text` starts with `# TRANSCRIPT-ONLY REPORT` and contains no fabricated lab values or imaging findings.
   - No differentials generated from empty visual/lab data (per Phase 6 Task 42).

## Automated check (case report service)

The case report service (Phase 6) implements the transcript-only guard: when `signal_analysis` is empty and there are no visual findings, it runs `_run_transcript_only_path()`, which:

- Sets header: `# TRANSCRIPT-ONLY REPORT`
- Adds: *"(No imaging or lab data provided; findings from transcript only.)"*
- Does not generate differentials from empty data.

To assert in tests: POST to case report service with `file_paths: []` and a transcript; expect `report_markdown` to contain `TRANSCRIPT-ONLY REPORT` and no lab/imaging conclusions.

## Middleware verification query

After callback, check the report content:

```sql
SELECT id, job_id, status, substr(case_report_text, 1, 200) AS report_preview
FROM fhir_diagnostic_reports
WHERE encounter_id = ? AND status = 'completed'
ORDER BY created_at DESC LIMIT 1;
```

Expect `report_preview` to start with `# TRANSCRIPT-ONLY REPORT`.
