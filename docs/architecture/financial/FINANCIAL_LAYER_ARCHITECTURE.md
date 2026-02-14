# DocLittle Financial Layer - Detailed Architecture Document

> **Note on Naming:** The codebase uses **Stedi** (not "Stepi") for the healthcare EDI API. Stedi is the insurance claims/eligibility provider.

---

## Table of Contents

1. [Executive Overview](#1-executive-overview)
2. [Stedi API & Insurance Integration](#2-stedi-api--insurance-integration)
3. [Medical Billing, Codes & Knowledge Base](#3-medical-billing-codes--knowledge-base)
4. [End-to-End Financial Flow](#4-end-to-end-financial-flow)
5. [Database Schema](#5-database-schema)
6. [Voice Agent Integration](#6-voice-agent-integration)
7. [Component Reference](#7-component-reference)

---

## 1. Executive Overview

### 1.1 Purpose

The Financial Layer orchestrates healthcare revenue operations: insurance eligibility verification, claim submission, medical coding, EOB (Explanation of Benefits) calculation, invoicing, and patient payments. It integrates external APIs (Stedi for X12 EDI), internal knowledge bases (ICD-10, CPT, coding rules), and AI-assisted medical coding.

### 1.2 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           FINANCIAL LAYER ARCHITECTURE                                    │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│   VOICE AGENT          HTTP API            SERVICES              EXTERNAL APIS            │
│   (Retell)              (server.js)                                                       │
│       │                      │                                                           │
│       │ collect_insurance    │  /voice/insurance/collect        ┌──────────────────┐      │
│       ├─────────────────────┼─────────────────────────────────►│  Stedi API       │      │
│       │                      │  /voice/insurance/check-eligibility  X12 270/271   │      │
│       │                      │  /voice/insurance/submit-claim      X12 837        │      │
│       │                      │                                    X12 276/277    │      │
│       │ get_patient_claims   │                                    /payers        │      │
│       │                      │                                 └────────┬─────────┘      │
│       │                      │                                          │                │
│       │                      │  ┌───────────────────────────────────────┘                │
│       │                      │  │                                                       │
│       │                      │  ▼                                                       │
│       │                      │  InsuranceService ──────► PayerCacheService              │
│       │                      │         │                                                 │
│       │                      │         ▼                                                 │
│       │                      │  EOBCalculationService ◄──── Eligibility + Claims         │
│       │                      │         │                                                 │
│       │                      │         ▼                                                 │
│       │                      │  InvoiceService ────────► PDFInvoiceService               │
│       │                      │                                                          │
│       │                      │  ┌────────────────────────────────────────────────────┐  │
│       │                      │  │  CODING PIPELINE (Knowledge Base)                   │  │
│       │                      │  │  PDFCodingService → CodingOrchestrator              │  │
│       │                      │  │       → MedicalCodingService (Groq)                 │  │
│       │                      │  │       → KnowledgeService                            │  │
│       │                      │  │  Knowledge: icd10_reference.json, simple-coding-rules│  │
│       │                      │  │  DB: cpt_codes, bulkUpsertCptCodes                   │  │
│       │                      │  └────────────────────────────────────────────────────┘  │
│       │                      │                                                          │
│       │                      │  FHIRService ───────────► Stripe Issuing (on-demand cards)│
│       │                      │  EmailService ──────────► Insurance billing emails        │
│       │                      │                                                          │
└───────┴──────────────────────┴──────────────────────────────────────────────────────────┘
```

### 1.3 Key Capabilities

| Capability | Description | Primary Service |
|------------|-------------|-----------------|
| Insurance Eligibility | X12 270/271 real-time verification | InsuranceService + Stedi |
| Claim Submission | X12 837 electronic claim submission | InsuranceService + Stedi |
| Claim Status | X12 276/277 status checks | InsuranceService + Stedi |
| Payer Lookup | Search/validate insurance payers | PayerCacheService + Stedi |
| Medical Coding | ICD-10/CPT from clinical notes | MedicalCodingService, KnowledgeService |
| EOB Calculation | Patient responsibility breakdown | EOBCalculationService |
| Invoice Generation | Patient invoices from claims | InvoiceService |
| Payment Cards | Stripe Issuing for copays/bills | FHIRService |

---

## 2. Stedi API & Insurance Integration

### 2.1 Stedi API Overview

**Provider:** Stedi (https://api.stedi.com)  
**Auth:** Bearer token via `STEDI_API_KEY`  
**Purpose:** Healthcare X12 EDI translation and payer connectivity for eligibility, claims, and status.

**Configuration:**
```javascript
// insurance-service.js
STEDI_API_BASE = process.env.STEDI_API_BASE || 'https://api.stedi.com'
STEDI_API_KEY = process.env.STEDI_API_KEY || 'test_1rRzTb0.Va9Tn88BB3fgPgttprqbrxQ1'
```

### 2.2 Stedi Endpoints Used

| Transaction | Stedi Endpoint | Purpose |
|-------------|----------------|---------|
| Eligibility (270/271) | `POST /x12/translate/270-to-edi` | Check patient insurance for a service |
| Claim (837) | `POST /x12/translate/837-to-edi` | Submit healthcare claim |
| Status (276/277) | `POST /x12/translate/276-to-edi` | Check claim status |
| Payers | `GET /payers`, `GET /payers/search` | List/search insurance payers |

**Docs:** `docs/integrations/stedi/api/STEDI_API_ENDPOINTS.md`

### 2.3 InsuranceService

**File:** `middleware-platform/services/insurance-service.js`

| Method | Description | Stedi Usage |
|--------|-------------|-------------|
| `checkEligibility(eligibilityData)` | X12 270/271 eligibility check | Calls 270-to-edi, stores result in `eligibility_checks` |
| `submitClaim(claimData)` | X12 837 claim submission | Calls 837-to-edi, stores in `insurance_claims` |
| `checkClaimStatus(claimId)` | X12 276/277 status check | Calls 276-to-edi, updates claim status |
| `fetchPayers(options)` | List/search payers | GET /payers or /payers/search |
| `mapAppointmentTypeToCPT(type)` | Map appointment → CPT | Static mapping (90834, 90837, etc.) |
| `mapAppointmentTypeToICD10(type)` | Map appointment → ICD-10 | Static mapping (F41.9, Z00.4, etc.) |

**Behavior:**
- On Stedi API failure, falls back to simulation (mock responses for BCBS, AETNA, UHC).
- Idempotency: avoids duplicate claims via `idempotency_key`.
- On claim submit: creates Stripe Issuing card for patient responsibility when applicable.

### 2.4 PayerCacheService

**File:** `middleware-platform/services/payer-cache-service.js`

Caches insurance payers to reduce Stedi API usage:

1. **Lookup flow:** DB (`insurance_payers`) → Stedi → Cache result.
2. **Key methods:**
   - `searchPayer(searchTerm)` – search by name
   - `getPayerById(payerId)` – lookup by payer ID
   - `validatePatientInsurance(payerName, memberId)` – used by voice agent
   - `syncPayerList(limit)` – background sync from Stedi

**Fallback payers:** Cigna, Aetna, BCBS, UnitedHealthcare, Humana.

### 2.5 Voice Agent Insurance Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/voice/insurance/collect` | POST | Collect & verify insurance during call; runs eligibility |
| `/voice/insurance/check-eligibility` | POST | Check eligibility for appointment |
| `/voice/insurance/submit-claim` | POST | Submit claim for appointment |

### 2.6 Insurance Data Flow

```
Patient provides: name, DOB, member_id, payer_name
       │
       ▼
PayerCacheService.validatePatientInsurance(payerName, memberId)
       │
       ▼
InsuranceService.checkEligibility({ patientName, dateOfBirth, memberId, payerId, serviceCode, dateOfService })
       │
       ▼
Stedi: POST /x12/translate/270-to-edi
       │
       ▼
db.createEligibilityCheck({ eligible, copay_amount, allowed_amount, insurance_pays, deductible_total, ... })
       │
       ▼
Return: { eligible, copay, allowedAmount, insurancePays, planSummary, ... }
```

---

## 3. Medical Billing, Codes & Knowledge Base

### 3.1 Knowledge Base Structure

**Location:** `Knowledge/`

| Resource | Path | Description |
|----------|------|-------------|
| ICD-10 Reference | `Knowledge/ICD-10 Files/icd10_reference.json` | Fallback (~271 codes); primary: `icd10_codes` DB (~72K) |
| ICD-10 DB | `icd10_codes` table | From `scripts/import-icd10-codes.js`; source: icd10cm_codes_2020.txt |
| CPT DB | `cpt_codes` table | From `scripts/import-cpt-codes.js`; source: DHS addendum xlsx (~1.3K) |
| HCPCS DB | `hcpcs_codes` table | From `scripts/import-hcpcs-codes.js`; CMS HCPC2026 (~9K) |
| Simple Coding Rules | `Knowledge/rules/simple-coding-rules.json` | 30+ rules mapping clinical patterns → ICD-10 + CPT |
| Code-Pair Validation | `Knowledge/rules/code-pair-validation.json` | Incompatible ICD-10 + CPT pairs (e.g. psychiatric + surgical) |
| Triage Rules | `Knowledge/rules/triage-rules.json` | Emergent (9) + urgent (4) scenarios; rule-based triage |
| Medical Abbreviations | `Knowledge/ontology/medical-abbreviations.json` | 75+ abbreviations (SOB, HA, CP, DM, etc.) |
| Medical Entities | `Knowledge/ontology/medical-entities.json` | Symptom synonyms, severity indicators, temporal patterns |
| Extraction Patterns | `Knowledge/ontology/extraction-patterns.json` | Regex for symptoms, vitals, temporal, severity |
| Severity Indicators | `Knowledge/ontology/severity-indicators.json` | Pain scale (1–10), temporal (acute/subacute/chronic) |

### 3.2 Simple Coding Rules Format

Each rule has:
- `id` – rule identifier
- `match` – conditions: `appointment_type`, `duration_minutes`, `diagnosis_keywords`, `procedure_keywords`
- `icd10` – array of `{ code, description }`
- `cpt` – array of `{ code, description }`
- `rationale` – human-readable explanation

**Example rule (psychotherapy_45):**
```json
{
  "id": "psychotherapy_45",
  "match": {
    "appointment_type": "Outpatient psychotherapy",
    "duration_minutes": 45,
    "diagnosis_keywords": ["anxiety", "depression", "ptsd", "trauma", "stress"],
    "procedure_keywords": ["psychotherapy", "cbt", "therapy", "counseling"]
  },
  "icd10": [{"code": "F41.1", "description": "Generalized anxiety disorder"}],
  "cpt": [{"code": "90837", "description": "Psychotherapy, 60 minutes..."}]
}
```

### 3.3 KnowledgeService

**File:** `middleware-platform/services/knowledge-service.js`

| Method | Description |
|--------|-------------|
| `getCodeCandidates(clinicalNote, options)` | RAG: phrase extraction + keyword search → ICD-10, CPT, HCPCS candidates |
| `getCandidateCptCodes(note, options)` | Extract keywords, search `cpt_codes` DB, return ranked CPT candidates |
| `searchIcd10Codes(query, limit)` | DB or JSON fallback; phrase expansions for common terms |
| `searchHcpcsCodes(query, limit)` | Search `hcpcs_codes` for DME, supplies, modifiers |
| `validateCodesExist(codes)` | Verify codes exist in KB; reject hallucinated codes |
| `validateCodePair(icd10, cpt)` | Rule-based compatibility check; uses `code-pair-validation.json` |
| `matchSimpleRule({ appointmentType, durationMinutes, clinicalNote })` | Match first applicable rule from `simple-coding-rules.json` |
| `expandMedicalAbbreviations(text)` | Expand SOB, HA, CP, etc. from `medical-abbreviations.json` |
| `normalizeMedicalTerms(text)` | Map synonyms to canonical terms from `medical-entities.json` |
| `loadTriageRules()`, `loadMedicalEntities()`, `loadExtractionPatterns()` | Load ontology JSON; used internally |

**RAG pipeline:** `expandMedicalAbbreviations` → `normalizeMedicalTerms` → phrase extraction → phrase expansions (e.g. "well child" → "routine child health") → keyword search → rank by match count. Optional semantic search via `code_embeddings` when OPENAI_API_KEY set.

### 3.4 MedicalCodingService (AI-Assisted)

**File:** `middleware-platform/services/medical-coding-service.js`

Uses **Groq** (LLM) when `GROQ_API_KEY` is set; otherwise falls back to KnowledgeService.

| Method | Description |
|--------|-------------|
| `generateCodingSuggestion({ clinicalNote, encounterType, patientContext })` | Produces ICD-10 and CPT from clinical note using KnowledgeService candidates + Groq |

**Flow:**
1. Get CPT candidates via `knowledgeService.getCandidateCptCodes()`
2. Get ICD-10 reference via `knowledgeService.getReferenceIcdCodes()`
3. Build prompt with clinical note + reference codes
4. Call Groq (e.g. `llama-3.3-70b-versatile`)
5. Parse JSON: `{ icd10: [...], cpt: [...], rationale }`

### 3.5 CodingOrchestrator

**File:** `middleware-platform/services/coding-orchestrator.js`

Classifies encounters and routes to the right coding path:

| Band | Condition | Coding Source |
|------|-----------|---------------|
| SIMPLE | `matchSimpleRule()` returns a match | Simple rules (no LLM) |
| MODERATE | Few keywords (≤12) | KnowledgeService candidates only |
| COMPLEX | Otherwise | Groq (MedicalCodingService) |

```javascript
// runCodingPipeline(encounter, options = {})
// options: { payerId, dateOfService }
// Returns: { band, icd10, cpt, rationale, details }
// Per CPT (Tiba spec): { code, description, confidence, quantity, allowed_amount?, in_network? }
// confidence = min(φ^NLP_i, φ^rule_i, φ^historical_i); capped by φ_auth_cap when prior auth required but not on file
```

### 3.6 PDFCodingService

**File:** `middleware-platform/services/pdf-coding-service.js`

End-to-end PDF → codes + pricing:

1. `extractTextFromPDF(pdfBuffer)` – pdf-parse
2. `runCodingPipeline(encounter, { payerId, dateOfService })` – CodingOrchestrator (passes payerId for f^P_i, n_i)
3. `getCPTPricing(cptCodes, options)` – **FeeScheduleService** when `payerId` in options; else `CPT_PRICING_FALLBACK`
4. `calculateTotalCharge()` – sum of CPT prices

**Pricing:** Uses `FeeScheduleService.getAllowedAmountsForCodes(payerId, cptCodes)` when `processPDF` receives `payerId` (e.g. from `/api/pdf-coding/process` body). Fallback: 90837 $150, 90834 $120, 99213 $100, etc.

### 3.7 DiagnosisCodeMapper

**File:** `middleware-platform/services/diagnosis-code-mapper.js`

Maps ICD-10 → typical CPT and charges:

- `getCPTCodesForDiagnosis(diagnosisCode)` – e.g. S83.541 (ACL tear) → 99213, 73721, 97110, 97112
- `generateServiceLineItemsFromDiagnoses(diagnosisCodes, options)` – builds line items for EOB/invoices

Used when claims have diagnosis codes but no service line items.

### 3.8 CPT Code Storage

**Database:** `cpt_codes` table

- `code` (PK), `description`, `category`, `subcategory`, `is_new`
- Populated via `bulkUpsertCptCodes(items)` from external sources (e.g. DHS Excel)
- Search: `searchCptCodes(query, limit)`

---

## 4. End-to-End Financial Flow

### 4.1 Eligibility → Claim → EOB → Invoice

```
1. ELIGIBILITY
   Voice/API → InsuranceService.checkEligibility()
   → Stedi 270-to-edi → eligibility_checks

2. CLAIM SUBMISSION
   API → InsuranceService.submitClaim()
   → Stedi 837-to-edi → insurance_claims
   → FHIRService.createCardForBill/copay (if patient owes)

3. EOB CALCULATION
   EOBCalculationService.calculateEOBFromClaim(claim, eligibility, claimDetails)
   → Line items from claim/response_data OR DiagnosisCodeMapper
   → calculateEOB({ lineItems, eligibility })
   → Totals: amountBilled, allowedAmount, planPaid, deductible, copay, coinsurance, balanceBilling, whatYouOwe
   → Per-line: inNetwork (from fee_schedules); balance billing (1-n_i)×max(0, f_i-a_i) for out-of-network
   → OOP max cap: when oop_met + patient responsibility > oop_max, excess shifts to plan (Tiba spec 3.2)

4. SETTLEMENT (Tiba spec 4)
   SettlementService.getSettlementDecision(claim, codingResult, eob)
   → Φ = α×Φ_weighted + (1-α)×Φ_min
   → S(R_plan, Φ): full (Φ≥0.95), partial (0.70≤Φ<0.95), hold (Φ<0.70)
   → preAdjudication.settlementDecision: { decision, amount, escrowRemainder, aggregateConfidence }

5. INVOICE
   InvoiceService.createInvoiceFromClaim(claimId)
   → EOBCalculationService (patient responsibility)
   → db.createInvoice() + addInvoiceItem()
```

### 4.2 Confidence-Weighted Settlement (Tiba Spec 4)

**File:** `middleware-platform/services/settlement-service.js`

| Formula | Description |
|---------|-------------|
| Φ_weighted | Σ(φ_i × r^plan_i) / R_plan |
| Φ_min | min(φ_1, ..., φ_n) |
| Φ | α × Φ_weighted + (1 − α) × Φ_min |
| S(R_plan, Φ) | full if Φ ≥ θ_high; partial if θ_low ≤ Φ < θ_high; hold if Φ < θ_low |

**Config (env):** `THETA_HIGH=0.95`, `THETA_LOW=0.70`, `ALPHA=0.7`

**Decisions:** `full` (release R_plan), `partial` (release R_plan × Φ), `hold` (release 0, escrow R_plan)

### 4.3 Post-Adjudication Reconciliation (Tiba Spec 4.3, 3.4)

**File:** `middleware-platform/services/reconciliation-service.js`

When claim status becomes approved/paid: Δ_plan = final_R_plan − real_time_R_plan. Tolerance: auto-reconcile when |Δ| ≤ $10 or |Δ|/allowed ≤ 5%; else flag for manual. Actions: `release_additional`, `recover`, `flag_release`, `flag_recover`. `real_time_plan_paid` stored when pre-adjudication runs; `finalPlanPaid` from 277/835 or `paymentAmount`.

### 4.4 PDF → Claim Flow

```
1. PDF upload (pdf-coding.html)
2. PDFCodingService.processPDF()
   → extractTextFromPDF → runCodingPipeline → getCPTPricing
3. User creates claim with extracted codes
4. Claim stored with response_data: { coding, pricing }
5. EOB calculated from pricing.breakdown
6. User generates invoice
```

---

## 5. Database Schema

### 5.1 Insurance Tables

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `eligibility_checks` | id, patient_id, member_id, payer_id, service_code, eligible, copay_amount, allowed_amount, insurance_pays, deductible_total, deductible_remaining, coinsurance_percent, oop_max, oop_met, plan_summary | Stedi 270/271 results (oop_max/oop_met per Tiba spec) |
| `insurance_claims` | id, appointment_id, patient_id, member_id, payer_id, service_code, diagnosis_code, total_amount, copay_amount, insurance_amount, status, real_time_plan_paid, payment_amount, response_data, ... | X12 837 claims |
| `insurance_payers` | id, payer_id, payer_name, aliases, supported_transactions | Payer cache from Stedi |
| `patient_insurance` | id, patient_id, payer_id, member_id, group_number, plan_name, is_primary, is_verified | Patient insurance records |
| `code_acceptance_rates` | payer_id, cpt_code, acceptance_count, denial_count, last_updated | Tiba φ^historical (Phase 4) |

### 5.1a Historical & Prior Auth (Tiba Phase 4)

**CodeAcceptanceService** tracks (payer, CPT) acceptance/denial from claim outcomes. `getHistoricalConfidence(payerId, cptCode)` returns acceptance rate; used as φ^historical_i. Call `trackCodeOutcome(claimId, codes, status, payerId)` when claim status becomes approved/denied.

**Prior auth:** `Knowledge/rules/prior-auth-rules.json` lists CPTs requiring prior auth. When `requiresPriorAuth(cpt)` and auth not on file, confidence is capped at φ_auth_cap (default 0.6). Pass `authOnFile: true` in `runCodingPipeline` options when auth is on file.

### 5.2 Billing Tables

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `invoices` | id, claim_id, patient_id, invoice_number, status, amount, due_date | Patient invoices |
| `invoice_items` | id, invoice_id, service_date, description, cpt_code, icd_code, quantity, unit_price, total_price | Invoice line items |
| `invoice_payments` | id, invoice_id, payment_date, amount, payment_method, reference_number | Payment tracking |

### 5.3 Coding Tables

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `icd10_codes` | code, description, category, billable | ICD-10 reference (~72K) |
| `cpt_codes` | code, description, category, subcategory, is_new | CPT code reference |
| `hcpcs_codes` | code, long_desc, short_desc, type | HCPCS reference (~9K) |
| `fee_schedules` | payer_id, cpt_code, allowed_amount | Payer-specific pricing |
| `coding_decisions` | call_id, proposed_icd10, proposed_cpt, validation_status | Audit trail for validate_code_pair |
| `voice_call_states` | call_id, current_stage, state_data | Medical coding state machine |
| `voice_conversation_memory` | call_id, turn_number, role, content | Conversation history |

---

## 6. Voice Agent Integration

### 6.1 Retell Functions (Financial-Related)

| Function | Handler | Description |
|----------|---------|-------------|
| `collect_insurance` | `handleCollectInsurance` | Calls `/voice/insurance/collect`, validates payer, runs eligibility |
| `get_patient_claims` | `handleGetPatientClaims` | Fetches claims for patient |
| `create_appointment_checkout` | `handleCreateAppointmentCheckout` | Creates checkout with copay; may create Stripe card |

### 6.2 Medical Coding Voice Tools (Real-Time During Calls)

| Function | Handler | Description |
|----------|---------|-------------|
| `search_icd10_codes` | `handleSearchIcd10Codes` | Look up ICD-10 by symptom/condition/code |
| `search_cpt_codes` | `handleSearchCptCodes` | Look up CPT by procedure |
| `search_hcpcs_codes` | `handleSearchHcpcsCodes` | Look up HCPCS (DME, supplies, modifiers) |
| `suggest_codes_from_symptoms` | `handleSuggestCodesFromSymptoms` | Get ICD-10 + CPT from patient description; returns `validated_pairs` |
| `extract_medical_text` | `handleExtractMedicalText` | Extract { symptoms, vitals, severity, temporal } from utterance |
| `assess_urgency` | `handleAssessUrgency` | Triage: EMERGENT / URGENT / ROUTINE (rule-based from `triage-rules.json`) |
| `validate_code_pair` | `handleValidateCodePair` | Check ICD-10 + CPT compatibility; logs to `coding_decisions` |
| `check_payer_guidelines` | `handleCheckPayerGuidelines` | Check if payer has fee schedule |
| `get_code_pricing` | `handleGetCodePricing` | Get allowed amounts for CPT codes from fee schedule |

All invoke `knowledge-service`, `triage-service`, `medical-text-extraction-service`, or `fee-schedule-service`. State transitions tracked by `coding-state-service`.

### 6.3 Medical Coding State Flow

```
INTAKE → EXTRACTION → TRIAGE → CODING → VALIDATION → BILLING
```

| Stage | Trigger |
|-------|---------|
| INTAKE | Call start, scheduling tools |
| EXTRACTION | `extract_medical_text`, first user utterance |
| TRIAGE | `assess_urgency` |
| CODING | `suggest_codes_from_symptoms`, `search_icd10_codes`, `search_cpt_codes`, `search_hcpcs_codes` |
| VALIDATION | `validate_code_pair`, `check_payer_guidelines` |
| BILLING | `collect_insurance`, `get_code_pricing` |

**Persistence:** `voice_call_states`, `voice_conversation_memory`, `agent_state_snapshots`, `coding_decisions` (30-day retention). See `docs/architecture/voice-agent/STATE_FLOW.md`.

**Coding flow sequence:**

```
Patient (Voice)          Retell Agent          retell-websocket          Services
       │                       │                        │                    │
       │  "I have diabetes     │                        │                    │
       │   and need a checkup" │                        │                    │
       │─────────────────────>│                        │                    │
       │                       │  assess_urgency()      │                    │
       │                       │──────────────────────>│ triage-service     │
       │                       │<──────────────────────│ ROUTINE            │
       │                       │                        │                    │
       │                       │  search_icd10_codes()  │  knowledge-service │
       │                       │──────────────────────>│──────────────────>│
       │                       │<──────────────────────│<──────────────────│
       │                       │  search_cpt_codes()    │                    │
       │                       │──────────────────────>│──────────────────>│
       │                       │<──────────────────────│<──────────────────│
       │                       │                        │                    │
       │                       │  validate_code_pair()  │  code-pair rules   │
       │                       │──────────────────────>│  coding_decisions  │
       │                       │<──────────────────────│                    │
       │                       │                        │                    │
       │                       │  get_code_pricing()    │  fee-schedule-     │
       │                       │──────────────────────>│  service           │
       │                       │<──────────────────────│                    │
       │                       │                        │                    │
       │  "I've found codes..."│                        │                    │
       │<─────────────────────│                        │                    │
```

### 6.4 Triage Service (Red-Flag Detection)

**File:** `services/triage-service.js`

- `detectRedFlags(text)` – Rule-based from `Knowledge/rules/triage-rules.json`; returns EMERGENT (9 rules: chest pain, stroke, meningitis, seizure, anaphylaxis, etc.), URGENT (4 rules: high fever, fracture, severe pain), or ROUTINE
- `checkBeforeScheduling(conversationHistory)` – Blocks scheduling when EMERGENT
- Used by `assess_urgency` and `handleScheduleAppointment`

### 6.5 Collect Insurance Flow

```
Voice: collect_insurance({ patient_name, member_id, payer_name, date_of_birth, ... })
       │
       ▼
retell-websocket.js: handleCollectInsurance()
       │
       ▼
POST /voice/insurance/collect
       │
       ├─ PayerCacheService.validatePatientInsurance(payerName, memberId)
       ├─ FHIRService.findOrCreatePatient()
       ├─ InsuranceService.checkEligibility()
       ├─ db.upsertPatientInsurance()
       ▼
Return: { success, patient_id, coverage: { eligible, copay, ... } }
```

### 6.6 Stripe Issuing (On-Demand Cards)

Cards are created only when needed:

- On claim submit when patient owes (copay or post-insurance)
- On appointment checkout with copay/patient responsibility
- Only for patients with insurance (`patient_insurance`)

---

## 7. Component Reference

### 7.1 Services

| Service | Path | Dependencies |
|---------|------|--------------|
| InsuranceService | `services/insurance-service.js` | axios, db, Stedi |
| PayerCacheService | `services/payer-cache-service.js` | db, InsuranceService |
| EOBCalculationService | `services/eob-calculation-service.js` | FeeScheduleService |
| SettlementService | `services/settlement-service.js` | — |
| ReconciliationService | `services/reconciliation-service.js` | — |
| CodeAcceptanceService | `services/code-acceptance-service.js` | db, cache |
| FeeScheduleService | `services/fee-schedule-service.js` | db |
| AdjudicationService | `services/adjudication-service.js` | FeeScheduleService, EOBCalculationService, SettlementService, db |
| InvoiceService | `services/invoice-service.js` | db, EOBCalculationService |
| KnowledgeService | `services/knowledge-service.js` | fs, path, db |
| MedicalCodingService | `services/medical-coding-service.js` | Groq, KnowledgeService |
| CodingOrchestrator | `services/coding-orchestrator.js` | KnowledgeService, MedicalCodingService |
| PDFCodingService | `services/pdf-coding-service.js` | pdf-parse, CodingOrchestrator, FeeScheduleService, db |
| DiagnosisCodeMapper | `services/diagnosis-code-mapper.js` | Category-based ICD→CPT (E11, I10, J45, etc.) |
| MedicalTextExtractionService | `services/medical-text-extraction-service.js` | extraction-patterns, medical-entities, severity-indicators |
| ProviderDirectoryService | `services/provider-directory-service.js` | InsuranceService |

### 7.2 Environment Variables

| Variable | Purpose |
|----------|---------|
| `STEDI_API_BASE` | Stedi API base URL |
| `STEDI_API_KEY` | Stedi Bearer token |
| `GROQ_API_KEY` | Groq API key for medical coding |
| `GROQ_MODEL` | Model (default: llama-3.3-70b-versatile) |

### 7.3 Phase 3: Fee Schedules & Real-Time Adjudication

When payer fee schedule data is available:

1. **Fee schedules** (`fee_schedules` table) – Payer-specific allowed amounts per CPT code. Ingest via:
   - `GET /api/admin/fee-schedules?payerId=BCBS` – List
   - `POST /api/admin/fee-schedules` – Single upsert
   - `POST /api/admin/fee-schedules/bulk` – Bulk upload
   - Optional seed: `middleware-platform/scripts/seed-fee-schedules.js` (BCBS, Aetna, UHC sample rates)

2. **EOB calculation** – Uses `FeeScheduleService.resolveAllowedAmount()` when `payerId` + CPT exist; otherwise 85%/70% fallback.

3. **Pre-adjudication** – `GET /api/claims/:claimId/pre-adjudicate` runs real-time adjudication (claim + eligibility + fee schedule → EOB + pre-adjudication estimate).

4. **AdjudicationService** – `runAdjudication()`, `preAdjudicateClaim()` for estimates before claim submission.

### 7.4 Related Documentation

- `docs/architecture/voice-agent/AI_AGENT_FINANCIAL_LAYER_TODO.md` – **AI agent integration todo** (close backend–agent gap)
- `docs/architecture/voice-agent/MULTI_MODEL_REALITY_CHECK.md` – Voice vs PDF cost (98% vs 2%), multi-model deprioritized
- `docs/architecture/voice-agent/STATE_FLOW.md` – Medical coding state flow
- `docs/architecture/voice-agent/RUNBOOK.md` – Imports, evaluation, rules, troubleshooting
- `docs/architecture/voice-agent/MEDICAL_CODING_AGENT_TODO.md` – Implementation roadmap
- `docs/integrations/stedi/api/STEDI_API_ENDPOINTS.md` – Stedi endpoints
- `docs/integrations/stedi/api/STEDI_VS_UHC_FHIR_DATA_COMPARISON.md` – Stedi vs UHC FHIR
- `docs/integrations/stripe/issuing/STRIPE_ISSUING_ON_DEMAND.md` – Card creation rules
- `docs/knowledge-base/README.md` – Knowledge base architecture
- `docs/development/invoice-billing/IMPLEMENTATION_SUMMARY.md` – Invoice implementation

---

*Document generated from codebase analysis. Last updated: February 2026.*
