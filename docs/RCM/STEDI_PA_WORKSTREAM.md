# Stedi + Prior Authorization Workstream

This document scopes what we can complete with **Stedi** in the PA/claims workflow, and what must be routed to other rails.

## Key constraint

Stedi supports core EDI transactions for eligibility, claims, and claim status (270/271, 837, 276/277). **Stedi does not currently support X12 278 prior authorization submission.**

Implication: the “Stedi part” of PA v1 is:

1. Improve **PA detection** using eligibility response signals (271).
2. Build **PA case tracking** (`prior_auth_requests`) and surface status in UX.
3. Complete the **claims loop** to payers via Stedi (837 submit + webhook + polling).
4. Gate claim submission on approved PA and attach auth number when present.

Actual electronic PA submission must use:

- UHC FHIR write (UHC members), and/or
- a PA partner platform (Availity / Coverage Gorilla / other) with portal fallback, and/or
- manual submission with tracked status.

---

## 1. What Stedi can do for PA v1

### 1.1 Detect “PA required?” from 271 / eligibility

Stedi’s eligibility JSON can include benefit detail fields such as `authOrCertIndicator` (payer-specific). This is a **requirement signal**, not a case decision.

Docs references:

- Stedi guide (Oct 29, 2025): https://www.stedi.com/blog/how-to-check-for-prior-authorization-requirements-in-a-271-eligibility-response
- Stedi API reference: https://www.stedi.com/docs/healthcare/api-reference/post-healthcare-eligibility

What to look for in the response:

- `benefitsInformation[].authOrCertIndicator`:
  - `Y` = prior auth required
  - `N` = not required
  - `U` = unknown (payer needs more context; check free-text notes)
- Optional free-text notes:
  - `benefitsInformation[].additionalInformation[].description` may contain precert/prior-auth rules

Implementation targets:

- Extend [`middleware-platform/services/stedi-271-parser.js`](../../middleware-platform/services/stedi-271-parser.js) to parse and normalize:
  - `prior_auth_indicator`: `Y|N|U` (unknown)
  - optional mapping to the requested `procedureCode` / `serviceTypeCodes`
- Persist on `eligibility_checks` (new columns or JSON payload)

Exit criteria:

- A test matrix showing example eligibility responses for a few payers/CPTs.

Suggested initial test matrix (update with real payer IDs and sandbox members):

| payer_id | member_id | CPT | STC | Expected |
|----------|-----------|-----|-----|----------|
| (TBD) | (TBD) | 93306 | 30 | Y/N/U |
| (TBD) | (TBD) | 70551 | 30 | Y/N/U |
| (TBD) | (TBD) | 90834 | MH | Y/N/U + notes |

### 1.2 Claims submission and status (already present but needs completion)

Existing building blocks:

- [`middleware-platform/services/insurance-service.js`](../../middleware-platform/services/insurance-service.js)
  - `checkEligibility()` (270/271)
  - `submitClaim()` (837P/837I depending on `STEDI_CLAIM_SUBMISSION_MODE`)
  - `checkClaimStatus()` (276/277-style)
- Claim status webhook:
  - [`middleware-platform/routes/stedi-webhooks.js`](../../middleware-platform/routes/stedi-webhooks.js) (`/webhooks/stedi/claim-status`)
- Polling script fallback:
  - [`middleware-platform/scripts/poll-claim-statuses.cjs`](../../middleware-platform/scripts/poll-claim-statuses.cjs)

**Provider submit (implemented):** `POST /api/claims/:id/submit-payment` calls `InsuranceService.submitExistingClaim()` — 837 translate, Stedi Healthcare `raw-x12-submission` when `STEDI_API_KEY` is set, eligibility re-verify (30-day grace), PA gate, and `x12_claim_id` persistence.

### 1.3 Stedi Test Mode (local / sandbox)

Eligibility uses **Healthcare API v3 JSON** (`POST .../eligibility/v3`) with the request body sent **directly** (not wrapped in `{ json: ... }` — that shape is only for legacy translate on `core.us.stedi.com`).

**Scripts:**

| Script | Purpose |
|--------|---------|
| `node scripts/stedi-test-mode-probe.cjs` | DNS + eligibility v3 scenarios; reports `eligibilityApproved` |
| `node scripts/stedi-sandbox-integration.cjs` | Full audit (270/271, reverify, 837, gateway, 278/835/275 stubs) |

**Required `.env` (test key):**

```env
STEDI_API_KEY=test_...
STEDI_TEST_MODE=1
STEDI_API_BASE=https://core.us.stedi.com
STEDI_HEALTHCARE_BASE=https://healthcare.us.stedi.com
STEDI_CLAIM_SUBMISSION_MODE=professional
STEDI_TEST_PAYER_ID=STEDI
STEDI_TEST_MEMBER_ID=0000000001
```

**Pass criteria:** `stedi-sandbox-integration.cjs` marks 270/271 **PASS** only when `stediFallback` is false (real Stedi response, not simulation).

### Verified in sandbox (2026-05-26)
- **Eligibility (270/271):** Works via Stedi Healthcare **eligibility v3** (`POST .../eligibility/v3`) and requires the app to send the correct subscriber identity (patient name + DOB).
- **Reverify at submit:** Runs the eligibility re-check before claim submission (30-day grace window).
- **Provider submit loop:** 837 translate + claim row persistence works; in Test Mode, healthcare submit may still be denied (so `healthcareSubmitted=false` / `stediFallback=true` can occur).
- **276/277 status:** Polling returns a status and updates claim rows (full paid/remittance details depend on real Stedi claim status + 835 events).

---

## 2. What Stedi cannot do (must not be implied)

- Submit X12 278 prior authorization requests.
- Provide a general multi-payer PA case status stream for authorization cases.
- Replace payer portals for PA attachments and documentation requirements.

These limitations must be stated in:

- [`docs/RCM/PA_ARCHITECTURE.md`](./PA_ARCHITECTURE.md)
- [`docs/integrations/README.md`](../integrations/README.md)

---

## 3. Task list (Stedi workstream)

### Task 0 — Verify Stedi eligibility PA signals

Document the shape of Stedi eligibility responses for PA signals:

- confirm whether `authOrCertIndicator` appears in `benefitsInformation[]` for sandbox data
- confirm how the indicator relates to `procedureCode` vs `serviceTypeCodes`

Implementation/verification status:
- `services/stedi-271-parser.js` parses `authOrCertIndicator` into `prior_auth_indicator` and captures related notes into `prior_auth_notes`.
- `insurance-service.js` stores the indicator/notes on `eligibility_checks` from the v3 JSON eligibility response.
- `PUT /api/patient/insurance` now re-runs eligibility using the loaded FHIR patient's `name` + `birthDate` (prevents Stedi AAA 71 DOB-mismatch caused by defaults).

### Task 1 — Parse and store 271 PA indicators

- Implement parser output fields and persist them on `eligibility_checks`.
- Expose the new fields in the eligibility responses returned to Kelly / provider flows.

### Task 2 — Build PA case tracking tables

- Add `prior_auth_requests`.
- Add appointment-level fields: `requires_prior_auth`, `auth_status`, `prior_auth_request_id`.

### Task 3 — Complete Stedi claims loop from provider portal

- Wire provider “Submit claim” to call `InsuranceService.submitClaim()` (or `PayerGatewayService.submitClaim()`).
- Keep the DB-only status flip endpoint only for “internal workflow” if still needed, but do not label it as payer submission.

### Task 4 — Attach auth number to 837 (when approved)

- On claim submit: if PA approved → attach auth number (e.g., REF*G1) to the claim envelope.
- If PA required but not approved → block submission with clear error.

### Task 5 — Ops runbook (production)

Maintain the Stedi production checklist in:

- [`docs/deployment/RENDER_PRODUCTION_CHECKLIST.md`](../deployment/RENDER_PRODUCTION_CHECKLIST.md)

Key env vars:

- `STEDI_API_KEY`
- `STEDI_API_BASE`
- `STEDI_CLAIM_SUBMISSION_MODE=professional`
- `STEDI_WEBHOOK_SECRET`

Manual steps:

- Stedi webhook registration to `/webhooks/stedi/claim-status`

- Stedi webhook signature (optional, recommended):
  - If `STEDI_WEBHOOK_SECRET` is set, the server verifies HMAC-SHA256 using the header `x-stedi-signature` (or `stedi-signature`).

---

- Stedi webhook registration to `/webhooks/stedi/remittance-advice` (835):
  - Expected behavior:
    - Updates `insurance_claims.remittance_835_*` columns (`received_at`, `paid_amount`, `adjustment_reason`)
    - Stores full captured detail in `insurance_claims.remittance_835_detail`
    - Stores a lightweight 835 summary under `insurance_claims.response_data.remittance_835`
  - Note: ERA/835 ingestion remains webhook-driven in this Phase-1 implementation.

- Prior authorization status events to `/webhooks/stedi/prior-auth-status`:
  - Phase-1 behavior:
    - Best-effort maps the decision into the matching `prior_auth_requests` row (using any available identifiers: `priorAuthRequestId`, `tracking_number`, `appointment_id`, `claim_id`, `stedi_correlation_id`).
    - Updates the linked `appointments` PA fields so claims can pass the PA gate.
    - Persists the full raw decision payload into `prior_auth_requests.raw_response_json`.

---

When to use webhooks vs polling (fallback rules):
1. If webhooks are live for `claim-status` and `remittance-advice`, keep polling at low-frequency sanity-check levels (or disable).
2. If webhooks are missing/unreliable, polling restores eventual consistency for:
   - submitted/processing claim status transitions (276/277-style)
   - 835 reconciliation remains partially placeholder until Phase-2 polling/ingest is fully implemented.

Background job schedules (recommended starting points):
- `scripts/poll-claim-statuses.cjs`
  - Run every 15 minutes
  - Poll claims in `submitted`/`processing` older than 24 hours (override with `--hours`)
- `scripts/poll-remittance-advice.cjs`
  - Run daily (log-only placeholder); real 835 ingest is via `/webhooks/stedi/remittance-advice`
- `scripts/poll-prior-auth-statuses.cjs`
  - Stub/no-op placeholder for Phase-2 rail polling; keep off (or run manually during bring-up)

---

## 4. Phase 2 rails (outside Stedi)

- UHC FHIR write path: POST `ServiceRequest`, poll `Task` (UHC members)
- PA partner platform adapter (portal fallback, attachments)

