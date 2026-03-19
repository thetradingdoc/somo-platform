# Provider Signup Requirements

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
- **Data Retention**: See `docs/compliance/DATA_RETENTION_POLICY.md` and `docs/compliance/HEALTHCARE_LEGAL_REQUIREMENTS.md`.

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

- `docs/compliance/HEALTHCARE_LEGAL_REQUIREMENTS.md` — Legal and regulatory obligations
- `docs/compliance/DATA_RETENTION_POLICY.md` — Retention periods
- `docs/legal/TERMS_OF_SERVICE.md` — Platform terms
- `docs/deployment/guides/advanced/SIGNUP_FLOW_IMPLEMENTATION.md` — Technical implementation
