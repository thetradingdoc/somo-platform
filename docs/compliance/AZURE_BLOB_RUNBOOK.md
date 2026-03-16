# Azure Blob Storage — Compliance Runbook (Telemedicine Phase 1)

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
