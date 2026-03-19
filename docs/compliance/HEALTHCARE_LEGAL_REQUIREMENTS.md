# Healthcare Legal & Regulatory Requirements

**Purpose**: Document legal and regulatory obligations for the DocLittle platform when handling healthcare providers and patient data.  
**Scope**: US healthcare context; platform must abide by applicable federal and state law.  
**Last Updated**: March 2025

---

## 1. Overview

DocLittle operates in healthcare delivery and must comply with:

- **HIPAA** — Privacy and security of Protected Health Information (PHI)
- **State medical licensing** — Provider credential verification
- **Data retention** — Audit and legal hold requirements
- **Document handling** — Secure storage, PDF-only for sensitive documents

---

## 2. HIPAA Compliance

### 2.1 Business Associate Obligations

- **BAA**: When DocLittle handles PHI on behalf of covered entities (e.g., providers, clinics), a Business Associate Agreement (BAA) is required.
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
- **PHI**: Per `docs/compliance/DATA_RETENTION_POLICY.md`

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

See `docs/compliance/DATA_RETENTION_POLICY.md` for operational details.

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

- `docs/compliance/PROVIDER_SIGNUP_REQUIREMENTS.md` — Signup data requirements
- `docs/compliance/DATA_RETENTION_POLICY.md` — Retention periods and cleanup
- `docs/legal/TERMS_OF_SERVICE.md` — Platform terms
