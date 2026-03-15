# FHIR‑Native RCM Mapping (2026) — EMPI + EDI → FHIR

**Last Updated:** February 2026

Goal: make the Financial Intelligence Layer **FHIR‑first**. EDI (837/835) is an **ingest format**, not the internal data model. Normalize claims and remits into FHIR resources so agents operate on interoperable, longitudinal data.

---

## 1. Canonical identity: EMPI

**Why:** All RCM agents become unreliable without longitudinal identity across systems (FHIR, EDI, billing, wallets).

**Implementation (middleware DB):**

- `empi_persons` — canonical person id
- `empi_links` — links EMPI to source ids (`source_system`, `source_id`, `entity_type`, `confidence`)

Agents should prefer operating on `empi_id` and only fall back to `patient_id` when EMPI is not resolved.

---

## 2. FHIR resources to use (core set)

| Concern | FHIR resource | Notes |
|--------|---------------|------|
| Patient identity | `Patient` | Link to EMPI (`empi_links.source_system='fhir_patient'`) |
| Coverage | `Coverage` | Plan/payer membership |
| Claim submission | `Claim` | Represents the billed event |
| Payer adjudication | `ClaimResponse` | Response/line adjudication details |
| Remittance / payment explanation | `ExplanationOfBenefit` (EOB) | **Primary** resource for denials/adjustments/allowed/paid |
| Organizations | `Organization` | Payer and provider orgs |
| Payments | (internal) + EOB/ClaimResponse | FHIR does not standardize bank deposits; store deposits internally and link to EOB/Claim via references |

**Design rule:** RCM agents read/write *structured* data primarily from EOB + ClaimResponse, not raw EDI text.

---

## 3. EDI → FHIR normalization (high level)

### 3.1 837 (Claim) → FHIR `Claim`

Typical mapping:

- Subscriber/patient → `Patient`
- Payer → `Organization`
- Coverage details → `Coverage`
- Claim header + line items → `Claim.item[]`
- Diagnoses/procedures → `Claim.diagnosis[]`, `Claim.procedure[]` (use coding systems appropriately)

### 3.2 835 (Remittance) → FHIR `ExplanationOfBenefit` (+ `ClaimResponse`)

Typical mapping:

- Claim identifiers → `ExplanationOfBenefit.claim` reference or `identifier[]`
- Line adjudication amounts → `ExplanationOfBenefit.item[].adjudication[]`
- Reason/remark codes → represent in `adjudication.reason` and/or extensions
- Totals → `ExplanationOfBenefit.total[]` (allowed, paid, patient responsibility)

**Denials/adjustments:** represent as structured adjudication entries; keep the original reason code strings as `coding.code` plus display.

---

## 4. Template-driven mapping (recommended)

To avoid hard-coded transforms, define mapping templates per payer/source:

- **Input:** parsed EDI JSON (from HIPAAsuite/Cleo/etc.)
- **Output:** FHIR JSON (`Claim`, `ClaimResponse`, `ExplanationOfBenefit`)
- **Template engine:** Liquid/Handlebars (or equivalent)

This keeps payer quirks in config, not code.

---

## 5. Auditability & guardrails (2026)

All financial agents must write audit records:

- `ai_decisions_rcm` — agent_type, operation, input refs, snapshots, explanation, confidence, HITL status.

**Rule:** store an **audit rationale** (structured “why”) suitable for compliance, not patient-facing text. Use HITL thresholds for high-dollar or ambiguous cases.

---

## 6. What agents should consume

### Claims Specialist

- Consume: `ExplanationOfBenefit` + `ClaimResponse`
- Produce: denial classification + next-best-action (queue item), logged in `ai_decisions_rcm`

### Reconciliation Agent

- Consume: internal `deposits` + normalized EOB/ClaimResponse amounts
- Produce: match decisions, adjustments explanation; HITL for exceptions

### Patient Liaison

- Consume: longitudinal balances and coverage (EMPI-linked)
- Produce: patient-friendly explanations + payment plan proposals (HITL by policy)

---

## 7. Next build steps

1. Add `rcm_claims`, `rcm_remittances`, `rcm_deposits` tables (internal) and store parsed EDI payloads.
2. Implement EDI→FHIR mapper module (template-based) that outputs EOB/Claim/ClaimResponse.
3. Add a first “Claims Specialist v0” job: classify EOB reason codes into 5–10 buckets and log decisions to `ai_decisions_rcm`.

