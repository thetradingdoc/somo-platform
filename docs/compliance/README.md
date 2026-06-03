# compliance — consolidated documentation

**Single file:** All former `docs/compliance/**/*.md` content is merged here. **Last updated:** 2026-04-20

## Table of contents

- [Azure Blob Storage — Compliance Runbook (Telemedicine Phase 1) (`AZURE_BLOB_RUNBOOK.md`)](#azure-blob-runbook)
- [BAA Compliance Checklist (Telemedicine Phase 1) (`BAA_COMPLIANCE_CHECKLIST.md`)](#baa-compliance-checklist)
- [Data Retention Policy (`DATA_RETENTION_POLICY.md`)](#data-retention-policy)
- [Healthcare Legal & Regulatory Requirements (`HEALTHCARE_LEGAL_REQUIREMENTS.md`)](#healthcare-legal-requirements)
- [PHI-Safe Messaging Rule (Telemedicine Phase 1 — Task 11) (`PHI_SAFE_MESSAGING.md`)](#phi-safe-messaging)
- [Provider Signup Requirements (`PROVIDER_SIGNUP_REQUIREMENTS.md`)](#provider-signup-requirements)
- [Compliance Documentation (`README.md`)](#readme)
- [Reminder message content review (Telemedicine Phase 5 — Task 38) (`REMINDER_MESSAGE_CONTENT.md`)](#reminder-message-content)
---

## Introduction

Browse by anchor above. Each section notes the former file path.

---

<a id="azure-blob-runbook"></a>

## Azure Blob Storage — Compliance Runbook (Telemedicine Phase 1)

*Former path: `docs/compliance/AZURE_BLOB_RUNBOOK.md`*


**Purpose:** Tasks 9 and 12 — verify encryption and set retention before storing PHI in the `patient-uploads` container.

---

## Task 9 — AES-256 encryption at rest

Azure Storage uses **AES-256** encryption at rest by default. Before production PHI:

1. **Azure Portal** → your Storage account → **Security + networking** (or **Encryption**).
2. Confirm **Encryption type** = "Microsoft-managed keys" (or customer-managed). Both use AES-256.
3. Document in this runbook: *Verified [date] for account [name].*

If you use a separate storage account for patient uploads, repeat for that account.

---

## Task 12 — 7-year retention (lifecycle policy)

HIPAA minimum is 6 years; we set **7 years** for the `patient-uploads` container.

### Option A — Azure Portal

1. Storage account → **Data management** → **Lifecycle management**.
2. Add a rule:
   - **Scope:** Blob only; filter by container name = `patient-uploads`.
   - **Action:** Move to cool/archive after **2555 days** (~7 years), or **Delete** after 2555 days if you do not use tiering.
3. Save and enable the rule.

### Option B — ARM / Bicep

Define a `Microsoft.Storage/storageAccounts/managementPolicies` resource that applies a rule to the `patient-uploads` container with a delete (or tier) action after 2555 days.

### Verification

- After deployment, run a test blob and confirm the rule appears under Lifecycle management.
- Document: *7-year retention rule applied to patient-uploads on [date].*

---

## Task 10 — SAS token expiry (1 hour max)

**Enforced in code:** Any generation of blob SAS or direct-access URLs must use a maximum expiry of **1 hour** (3600 seconds). See `middleware-platform/config/blob-compliance.js` (or the module where blob URLs are generated) and use `SAS_MAX_EXPIRY_SECONDS` when creating SAS tokens. Do not expose blob URLs with longer expiry to clients.

---

## Task 19 — Create `patient-uploads` container (Phase 2)

Create a **private** container (no public blob access) for patient-uploaded documents.

### Container name

- **`patient-uploads`**

### Azure Portal

1. Storage account → **Containers** → **+ Container**.
2. Name: `patient-uploads`.
3. **Public access level:** Private (no anonymous access).
4. Create.

### Path convention (enforce in app when writing blobs)

- **With appointment:** `{patient_id}/{appointment_id}/{unix_timestamp}_{sanitised_filename}`
- **Pre-booking:** `{patient_id}/pre-visit/{unix_timestamp}_{sanitised_filename}`

Use these paths when implementing the upload portal (Phase 4) and when the case report service lists blobs. Do not expose container-level public read; use SAS with `SAS_MAX_EXPIRY_SECONDS` when generating any direct-access URL.


---

<a id="baa-compliance-checklist"></a>

## BAA Compliance Checklist (Telemedicine Phase 1)

*Former path: `docs/compliance/BAA_COMPLIANCE_CHECKLIST.md`*

**Purpose:** Track Business Associate Agreement (BAA) status before PHI flows through new telemedicine endpoints.  
**Reference:** `todos/pending/TELEMEDICINE_TODOS.md` Phase 1 — Tasks 1–4.

| # | Task | Owner | Status | Notes |
|---|------|--------|--------|-------|
| 1 | **Sign Microsoft Azure BAA** | Legal / Ops | ⬜ Pending | Required before storing PHI in Blob Storage and Postgres in production. Azure Portal → Compliance → Business Associate Agreement. |
| 2 | **Sign Twilio BAA** | Legal / Ops | ⬜ Pending | Required before sending appointment-linked communications (SMS/voice). Twilio Console → Compliance. |
| 3 | **Sign / confirm OpenAI BAA** | Legal / Ops | ⬜ Pending | Required before sending transcript or lab content to GPT-4o. [OpenAI Enterprise / BAA](https://openai.com/enterprise). |
| 4 | **Confirm Pinecone HIPAA BAA** | Legal / Ops | ⬜ Pending | Check [pinecone.io/security](https://www.pinecone.io/security); if unavailable, evaluate compliant alternative for RAG vector store. |

**When complete:** Update status above (e.g. ✅ Done + date). Do not enable production PHI for telemedicine until all four are confirmed.


---

<a id="data-retention-policy"></a>

## Data Retention Policy

*Former path: `docs/compliance/DATA_RETENTION_POLICY.md`*

## Overview

Retention periods for Doctor Little middleware platform data. Aligns with billing compliance (7 years for coding/claims) and operational needs.

## Retention by Data Type

| Table / Data | Retention | Rationale |
|--------------|-----------|-----------|
| `voice_call_log` | 1 year | Call history, troubleshooting |
| `coding_decisions` | 7 years | Billing compliance (CMS, payer audits) |
| `llm_usage_log` | 90 days | Cost analysis, performance tuning |
| `function_call_log` | 90 days | Debugging, audit trail |
| `voice_conversation_memory` | 30 days | Configurable in app |
| `idempotency_keys` | 24 hours | TTL; daily cleanup |
| `postgres_sync_retry` | 7 days | Retry queue |
| `postgres_sync_dlq` | 90 days | Manual review before purge |
| `hipaa_access_log` | 7 years | HIPAA audit requirement; delete after retention |
| `customers` (provider_profile) | 7 years after account closure | Licensing, credentialing audits |
| Provider license documents | 7 years | State/payer verification, credentialing |

See `docs/compliance/README.md#healthcare-legal-requirements` for legal basis.

## Cleanup

Run periodically (e.g. daily cron):

```bash
cd middleware-platform
node scripts/cleanup-retention.js
```

Or with `--dry-run` to preview:

```bash
node scripts/cleanup-retention.js --dry-run
```

## Legal Hold

If a legal hold applies, pause cleanup for affected tables. Document hold in `docs/compliance/legal-holds/`.


---

<a id="healthcare-legal-requirements"></a>

## Healthcare Legal & Regulatory Requirements

*Former path: `docs/compliance/HEALTHCARE_LEGAL_REQUIREMENTS.md`*

**Purpose**: Document legal and regulatory obligations for the Somo platform when handling healthcare providers and patient data.  
**Scope**: US healthcare context; platform must abide by applicable federal and state law.  
**Last Updated**: March 2025

---

## 1. Overview

Somo operates in healthcare delivery and must comply with:

- **HIPAA** — Privacy and security of Protected Health Information (PHI)
- **State medical licensing** — Provider credential verification
- **Data retention** — Audit and legal hold requirements
- **Document handling** — Secure storage, PDF-only for sensitive documents

---

## 2. HIPAA Compliance

### 2.1 Business Associate Obligations

- **BAA**: When Somo handles PHI on behalf of covered entities (e.g., providers, clinics), a Business Associate Agreement (BAA) is required.
- **Data minimization**: Collect only what is necessary for the stated purpose.
- **Access controls**: Limit access to PHI to authorized personnel; log access where required.
- **Encryption**: PHI at rest and in transit must be encrypted per HIPAA Security Rule.

### 2.2 PHI Handling

| Data Type | Classification | Handling |
|-----------|----------------|----------|
| Patient names, DOB, identifiers | PHI | Encrypt, access controls, audit log |
| Provider license, specialty | Provider PII | Protected, access controls |
| Call transcripts, clinical notes | PHI | Same as above |

### 2.3 Retention

- **hipaa_access_log**: 7 years (audit requirement)
- **PHI**: Per `docs/compliance/README.md#data-retention-policy`

---

## 3. Provider Licensing Requirements

### 3.1 Legal Basis

- **State medical boards**: License numbers are issued by state boards; verification may be required.
- **Payer credentialing**: Medicare, Medicaid, and commercial payers typically require verified license, specialty, and state.
- **Telehealth**: Many states require licensure in the state where the patient is located.

### 3.2 What We Require

- **License number** — Required at signup
- **State of licensure** — Required at signup
- **License document (PDF)** — Recommended for audit trail; PDF-only per security policy
- **Medical specialty** — Required for credentialing and patient matching

### 3.3 Verification (Future)

- Manual or automated verification against state medical board databases.
- Document retention for license copies per state and payer requirements.

---

## 4. Document Format: PDF Only

### 4.1 Policy

- **License documents**: PDF format only. No .doc, .docx, or other formats.
- **Rationale**:
  - Reduces executable content risk
  - Consistent audit trail format
  - Widely accepted for legal/regulatory submissions

### 4.2 Implementation

- Form: `accept="application/pdf"` on file inputs
- Backend: Validate MIME type and file extension before storage
- Reject non-PDF uploads with clear error message

---

## 5. Data Retention

| Data | Retention | Legal Basis |
|------|-----------|-------------|
| Provider profile (license, etc.) | 7 years after account closure | Potential audits, credentialing |
| PHI / clinical data | Per BAA and state law | HIPAA, state medical records |
| hipaa_access_log | 7 years | HIPAA audit |
| coding_decisions | 7 years | CMS, payer audits |

See `docs/compliance/README.md#data-retention-policy` for operational details.

---

## 6. Legal Hold

- When litigation or investigation requires preservation of data, a legal hold applies.
- **Action**: Pause automated retention cleanup for affected tables.
- **Documentation**: Record holds in `docs/compliance/legal-holds/` (create folder if needed).

---

## 7. Terms of Service & Consent

- Providers must accept Terms of Service before platform access.
- Terms include data use, retention, and compliance obligations.
- See `docs/legal/TERMS_OF_SERVICE.md`.

---

## 8. Checklist: Abiding by the Law

- [ ] BAA in place with covered entities when handling PHI
- [ ] Provider license number and state required at signup
- [ ] License documents: PDF only, validated on upload
- [ ] PHI encrypted at rest and in transit
- [ ] Access logs retained per HIPAA (7 years)
- [ ] Data retention policy followed
- [ ] Legal hold process documented
- [ ] Terms of Service accepted before access

---

## 9. Related Documentation

- `docs/compliance/README.md#provider-signup-requirements` — Signup data requirements
- `docs/compliance/README.md#data-retention-policy` — Retention periods and cleanup
- `docs/legal/TERMS_OF_SERVICE.md` — Platform terms


---

<a id="phi-safe-messaging"></a>

## PHI-Safe Messaging Rule (Telemedicine Phase 1 — Task 11)

*Former path: `docs/compliance/PHI_SAFE_MESSAGING.md`*


**Rule:** No health data in any SMS or email **body**. Apply to all reminder and notification templates (upload link, booking confirmation, T-24h, T-1h, case report ready, upload confirmation).

---

## Allowed in message body

- Appointment **date and time**
- **Join** link (video)
- **Upload** link (portal URL)
- **Portal** link (e.g. view report)
- Generic phrasing: "Your appointment", "Your documents have been received", "Case report ready"

---

## Never in message body

- Patient name together with diagnosis, condition, or symptom
- Lab values, test results, or findings
- Diagnosis or condition names
- Medication names or dosages
- Any PHI that could identify the individual’s health status

---

## Templates to review

When implementing telemedicine reminders and notifications, ensure each template passes the checklist:

| Template | Location / trigger | Checklist |
|----------|--------------------|-----------|
| Upload link email | Phase 3 – send-upload-link | No PHI in subject/body |
| Upload confirmation email | Phase 4 – after first upload | No filenames, no health data |
| Booking confirmation | Phase 5 – on appointment create | Time + upload link only |
| T-24h reminder | Phase 5 – cron | Time + upload link only |
| T-1h reminder | Phase 5 – cron | Time + join link only |
| Case report ready (email) | Phase 9 – callback | "Case report ready" + portal link only |
| Case report ready (SMS) | Phase 9 – callback | Date + portal link only |

Use the validation helper in code when rendering templates: `require('../utils/phi-safe-messaging').validatePhiSafeMessage(body)`.


---

<a id="provider-signup-requirements"></a>

## Provider Signup Requirements

*Former path: `docs/compliance/PROVIDER_SIGNUP_REQUIREMENTS.md`*

**Purpose**: Define required data, validation rules, and legal basis for the specialist provider portal signup flow.  
**Scope**: Individual medical specialists only (no company/organization signup).  
**Last Updated**: March 2025

---

## 1. Overview

The provider portal captures individual medical specialist credentials, location, and contact information to:

- Verify provider identity and licensure
- Comply with state and federal healthcare regulations
- Enable credentialing and payer enrollment
- Support HIPAA Business Associate Agreement (BAA) obligations

---

## 2. Required Fields

| Field | Required | Validation | Legal/Regulatory Basis |
|-------|----------|------------|-------------------------|
| **First name** | Yes | Non-empty, reasonable length | Identity verification, BAA |
| **Last name** | Yes | Non-empty, reasonable length | Identity verification, BAA |
| **Work email** | Yes | Valid format, unique per account | Account creation, HIPAA contact |
| **Phone number** | Yes | E.164 format | Contact, emergency, BAA |
| **City** | Yes | Select or type (datalist from API) | Service area, licensing jurisdiction |
| **Postal / Zip code** | Yes | Non-empty | Service area, licensing jurisdiction |
| **Country** | Yes | ISO 3166 dropdown (worldwide) | Jurisdictional compliance |
| **Country code** | Yes | ISO 3166-1 alpha-2 (e.g. US, GB) | Location matching |
| **Medical specialty** | Yes | From approved list | Credentialing, payer enrollment |
| **License number** | Yes | Non-empty | State licensing verification requirement |
| **License state** | Yes | Valid US state or "Other" | License jurisdiction, verification |
| **License document** | Optional* | PDF only, max 5MB | Verification audit trail |
| **Profile photo** | Optional | JPG/PNG/WebP | Provider identification |
| **Languages spoken** | Optional | Array of ISO 639-1 codes (e.g. en, es, zh) | Patient matching (preferred_language) |

*\*License document upload recommended for credentialing; backend upload endpoint may be added to make it required.*

---

## 3. Document Format Requirements

| Document Type | Allowed Format | Max Size | Rationale |
|---------------|----------------|----------|-----------|
| License document | **PDF only** | 5 MB | Audit trail, readability, no executable content |
| Profile photo | JPG, PNG, WebP | 5 MB | Standard image formats |

**Rejection**: Word (.doc/.docx) and other non-PDF documents are not accepted for licensing documents per security and audit policy.

---

## 4. Validation Rules (Backend)

The signup API (`POST /api/signup`) enforces:

1. **Name**: `first_name` or `last_name` present → build `name`; else require `name`
2. **Specialist flow**: If `first_name`, `last_name`, or `medical_specialty` present:
   - `license_number` and `license_state` are **required**
   - `city`, `postal_code`, `country` are **required**
   - `medical_specialty` is **required**
3. **Email**: Valid format, not already registered (except test bypass when enabled)
4. **Phone**: Required for SaaS customers; formatted to E.164

---

## 5. Data Storage

- **Provider profile** stored as JSON in `customers.provider_profile`:
  - `first_name`, `last_name`, `city`, `postal_code`, `country`, `country_code` (ISO 3166)
  - `medical_specialty`, `license_number`, `license_region` (state code or region text)
  - `languages` (array of ISO 639-1 codes for patient matching)
- **License document / photo**: Not yet persisted; upload endpoint to be implemented; storage must comply with data retention and HIPAA requirements.

---

## 6. Legal References

- **HIPAA**: Business Associate Agreement (BAA) requires verified provider identity and contact information.
- **State licensing**: License number and state are required for verification against state medical boards.
- **Credentialing**: Payer enrollment (Medicare, Medicaid, commercial) typically requires license, specialty, and location.
- **Data Retention**: See `docs/compliance/README.md#data-retention-policy` and `docs/compliance/README.md#healthcare-legal-requirements`.

---

## 7. Medical Specialty Options

Approved options (form dropdown):

- Family Medicine
- Internal Medicine
- Pediatrics
- Dermatology
- Psychiatry
- Cardiology
- Orthopedics
- OB/GYN
- Neurology
- Geriatrics
- Home Health
- Telehealth
- Other

---

## 8. Related Documentation

- `docs/compliance/README.md#healthcare-legal-requirements` — Legal and regulatory obligations
- `docs/compliance/README.md#data-retention-policy` — Retention periods
- `docs/legal/TERMS_OF_SERVICE.md` — Platform terms
- `docs/deployment/README.md#guides-advanced-signup-flow-implementation` — Technical implementation


---

<a id="readme"></a>

## Compliance Documentation

*Former path: `docs/compliance/README.md`*

**Purpose**: Central index for legal, regulatory, and compliance requirements. Documentation is key; the platform must abide by applicable law.

**Last Updated:** April 9, 2026

---

## Documents

| Document | Description |
|----------|-------------|
| [PROVIDER_SIGNUP_REQUIREMENTS.md](./README.md#provider-signup-requirements) | Required provider data, validation rules, document formats (PDF only for license docs) |
| [HEALTHCARE_LEGAL_REQUIREMENTS.md](./README.md#healthcare-legal-requirements) | HIPAA, licensing, data retention, document policy |
| [DATA_RETENTION_POLICY.md](./README.md#data-retention-policy) | Retention periods by data type; cleanup procedures |
| [BAA_COMPLIANCE_CHECKLIST.md](./README.md#baa-compliance-checklist) | Business Associate Agreement compliance |
| [PHI_SAFE_MESSAGING.md](./README.md#phi-safe-messaging) | PHI handling in messaging |

---

## Quick Reference: Provider Signup

- **Required**: First name, Last name, Email, Phone, City, Postal code, Country, Medical specialty, License number, License state
- **Documents**: License document — **PDF only**; profile photo — JPG/PNG/WebP
- **Legal basis**: HIPAA BAA, state licensing, payer credentialing

---

## Legal Hold

When a legal hold applies, pause automated retention cleanup and document in `docs/compliance/legal-holds/`.


---

<a id="reminder-message-content"></a>

## Reminder message content review (Telemedicine Phase 5 — Task 38)

*Former path: `docs/compliance/REMINDER_MESSAGE_CONTENT.md`*


**Purpose:** Ensure no PHI or health data appears in any SMS or email reminder body.

## Rules (verify for every reminder channel)

- **No** patient name combined with health condition, diagnosis, or clinical detail.
- **No** lab values, results, or test data.
- **No** diagnosis or treatment details.
- **No** health data of any kind in the message body.

## What is allowed

- Appointment **date/time** (generic “your appointment”, “appointment tomorrow at [time]”).
- **Links** only: upload portal link, join/video link. No PHI in URL path (token is opaque).
- Generic wording: “Reminder”, “Upload documents”, “Join here”, “Appointment confirmed”.

## Where reminders are sent

| Trigger        | Email                         | SMS (if phone present)                          |
|----------------|-------------------------------|-------------------------------------------------|
| Booking (35)   | Confirmation + upload link     | “Appointment confirmed for [time]. Upload: [link]” |
| T-24h (36)    | “Appointment tomorrow at [time]. Upload: [link]” | Same text (upload link)                    |
| T-1h (37)     | “Your appointment is in 1 hour. Join here: [link]” | Same text (join link)                     |

Implementation: `middleware-platform/services/reminder-scheduler.js`, `services/telemedicine-reminders.js`, `services/email-service.js` (sendAppointmentConfirmation, sendAppointmentReminder24h, sendAppointmentReminder). Patient name may appear in email salutation (“Dear [name]”) only; no health data in body.

## Review checklist (Task 38)

- [ ] No patient name + health condition in same message.
- [ ] No lab values in any SMS or email.
- [ ] No diagnosis in any SMS or email.
- [ ] No health data in any SMS or email body.


