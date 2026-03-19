# DocLittle Platform: Architecture Overview & Colab RAG Integration

**Document Purpose**: Single reference for (1) connecting Colab RAG, (2) billing/medical coding agent architecture, (3) medical reasoning flow, (4) voice agent integration, and (5) payment for appointments.

---

## 1. Connecting Your Colab RAG

### 1.1 Architecture Overview

```
┌─────────────────────┐     POST /retrieve      ┌─────────────────────┐
│  Colab RAG          │ ◄────────────────────── │  middleware         │
│  (Pinecone-backed) │                         │  remote-rag-client   │
│  localhost:5000     │     POST /health        │  (knowledge-service) │
│  or Render URL      │ ◄────────────────────── │                     │
└─────────────────────┘                         └─────────────────────┘
        ▲                                              │
        │ COLAB_RAG_URL                                │ RAG_API_URL
        │ (proxy target)                               │ (caller target)
        └─────────────────────────────────────────────┘
                     rag-proxy routes /api/rag/*
```

### 1.2 Two Connection Modes

#### Option A: Via Middleware Proxy (Recommended for local Colab)

When Colab runs on `localhost:5000` (or another local port), the middleware proxies requests so a single ngrok tunnel can reach both API and RAG.

1. **Start your Colab RAG** so it serves:
   - `POST /retrieve` or `POST /api/retrieve`
   - `GET /health`

2. **Set environment variables** (in `.env` or shell):

   ```env
   # Where the Colab RAG actually runs (proxy target)
   COLAB_RAG_URL=http://localhost:5000
   # Or if using a port:
   COLAB_RAG_PORT=5000

   # Where knowledge-service calls RAG (defaults to middleware proxy)
   RAG_API_URL=http://localhost:4000/api/rag
   ```

   When `RAG_API_URL=http://localhost:4000/api/rag`, the middleware:
   - Receives requests at `/api/rag/retrieve` and `/api/rag/health`
   - Forwards them to `COLAB_RAG_URL` (or `http://localhost:${COLAB_RAG_PORT}`)

#### Option B: Direct to Colab (Render / ngrok to Colab)

When Colab is publicly reachable (e.g., Render, ngrok to Colab):

```env
# Point directly at your Colab RAG
RAG_API_URL=https://your-colab-rag.onrender.com
# or
RAG_API_URL=https://xxxx.ngrok.io
```

In this case, `COLAB_RAG_URL` is only used by the rag-proxy for external clients; the knowledge-service talks directly to `RAG_API_URL`.

### 1.3 Colab RAG API Contract

Your Colab RAG must implement:

#### POST `/retrieve` (or `/api/retrieve`)

**Request body**:
```json
{
  "query": "patient reports chest pain and shortness of breath",
  "specialty": "general",
  "region": "US",
  "exclusion_terms": ["ruled out"],
  "top_k": 20
}
```

**Response body** (required shape):
```json
{
  "icd10": [
    { "code": "R07.9", "description": "Chest pain, unspecified", "score": 0.92 }
  ],
  "cpt": [
    { "code": "99213", "description": "Office visit, level 3", "score": 0.85 }
  ],
  "hcpcs": []
}
```

- `score` or `confidence` (0–1) is used for ranking; default 0.8 if missing.
- Empty arrays are fine; the platform falls back to local search when remote returns nothing.

#### GET `/health`

Return a JSON object (e.g., `{"status":"ok"}`) for health checks.

### 1.4 Files Involved

| File | Role |
|------|------|
| `middleware-platform/routes/rag-proxy.js` | Proxies `/api/rag/retrieve` and `/api/rag/health` to `COLAB_RAG_URL` |
| `middleware-platform/services/layer2-rag/remote-rag-client.js` | Calls Colab RAG via `retrieveFromColabRAG()` |
| `middleware-platform/services/knowledge-service.js` | Uses Colab RAG in `getCandidatesForCoding()` and `getCodeCandidatesDualSource()` |

### 1.5 Verification

```bash
# Test health (via proxy)
curl http://localhost:4000/api/rag/health

# Test retrieve (via proxy)
curl -X POST http://localhost:4000/api/rag/retrieve \
  -H "Content-Type: application/json" \
  -d '{"query":"chest pain","specialty":"general","top_k":10}'
```

---

## 2. Billing / Medical Coding Agent Architecture

### 2.1 State Machine (LangGraph-Style)

The medical coding agent follows a strict stage flow:

```
INTAKE → EXTRACTION → TRIAGE → CODING → VALIDATION → BILLING
```

| Stage | Description |
|-------|-------------|
| **INTAKE** | Call start; collecting patient info, scheduling |
| **EXTRACTION** | Patient described symptoms; extracting entities from speech |
| **TRIAGE** | Assessing urgency: EMERGENT / URGENT / ROUTINE |
| **CODING** | Searching ICD-10, CPT, HCPCS via RAG + local knowledge |
| **VALIDATION** | Validating code pairs, checking guidelines |
| **BILLING** | Insurance, pricing, checkout |

Transitions only advance forward (or to BILLING); no backwards transitions.

### 2.2 Persistence & Tables

| Table | Purpose |
|-------|---------|
| `voice_call_states` | Current stage and `state_data` per call |
| `voice_conversation_memory` | Turn-by-turn transcript (role, content) |
| `agent_state_snapshots` | Stage transition snapshots for audit |
| `coding_decisions` | ICD/CPT pairs proposed and validated |
| `function_call_log` | Tool calls, response times, success/failure |

### 2.3 Implemented Components

| Component | Location | Status |
|-----------|----------|--------|
| State flow service | `coding-state-service.js` | ✅ |
| Context assembler | `context-assembler-service.js` | ✅ |
| RAG pipeline | `knowledge-service.js`, `getCodeCandidates()` | ✅ |
| Red-flag detection | `triage-service.js` | ✅ |
| Code search (ICD-10, CPT, HCPCS) | DB + JSON reference | ✅ |
| Code-pair validation | `validateCodePair()`, rules | ✅ |
| Triage rules | `Knowledge/rules/triage-rules.json` | ✅ |
| Medical abbreviations | `Knowledge/ontology/medical-abbreviations.json` | ✅ |
| Phrase expansions | `MEDICAL_PHRASES`, `PHRASE_EXPANSIONS` | ✅ |

---

## 3. Medical Reasoning

### 3.1 RAG Pipeline

1. **Query construction**: Raw text → abbreviation expansion → synonym normalization → keyword/phrase extraction.
2. **Dual-source retrieval**:
   - **Remote (Colab RAG)**: When `RAG_API_URL` is set, `retrieveFromColabRAG()` is called first.
   - **Local**: Keyword search against `icd10_codes`, `cpt_codes`, `hcpcs_codes` (DB) or JSON reference.
3. **Merge & filter**:
   - Negative constraints (e.g., "ruled out X")
   - Guideline filtering (e.g., `filterIcd10ByGuidelines`)
   - Perceptual reranking when `perceptualState` is present
4. **Validation**: `validateCodePair(icd10, cpt)` and `validateCodesExist()` ensure codes exist and pairs are compatible.

### 3.2 Call Paths That Use RAG

| Path | Function | RAG Source |
|------|----------|------------|
| **Voice** | `suggest_codes_from_symptoms` | `getCodeCandidates()` → Colab + local |
| **PDF** | `getCandidatesForCoding()` | Colab (if URL set) + local fallback |
| **Video** | `getCodeCandidatesDualSource()` | Colab + local in parallel, merge |

### 3.3 Safety Layer

- **Triage**: `assess_urgency()` → `detectRedFlags()` (regex on triage-rules.json). EMERGENT blocks scheduling.
- **Pre-schedule check**: `checkBeforeScheduling()` prevents booking for emergency symptoms.
- **Code validation**: Rejects non-existent codes and incompatible ICD/CPT pairs.

---

## 4. Voice Agent Integration

### 4.1 End-to-End Flow

```
Patient calls → Retell (ASR + LLM + TTS) → WebSocket to middleware
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    ▼                         ▼                         ▼
              schedule_appointment    suggest_codes_from_symptoms   create_checkout
                    │                         │                         │
                    ▼                         ▼                         ▼
         /voice/appointments/schedule   knowledgeService.getCodeCandidates  /voice/checkout/create
                    │                         │                         │
                    ▼                         ▼                         ▼
              BookingService          Colab RAG + local merge      Payment flow
```

### 4.2 Voice Agent Tools (Functions)

| Function | Handler | Backend |
|----------|---------|---------|
| `schedule_appointment` | `handleScheduleAppointment` | `POST /voice/appointments/schedule` |
| `get_available_slots` | `handleGetAvailableSlots` | `POST /voice/appointments/available-slots` |
| `search_appointments` | `handleSearchAppointments` | `POST /voice/appointments/search` |
| `confirm_appointment` | `handleConfirmAppointment` | `POST /voice/appointments/confirm` |
| `cancel_appointment` | `handleCancelAppointment` | `POST /voice/appointments/cancel` |
| `reschedule_appointment` | `handleRescheduleAppointment` | `POST /voice/appointments/reschedule` |
| `create_appointment_checkout` | — | `POST /voice/appointments/checkout` |
| `create_checkout` | `handleCreateCheckout` | `POST /voice/checkout/create` |
| `verify_checkout_code` | — | `POST /voice/checkout/verify` |
| `assess_urgency` | `handleAssessUrgency` | `triage-service.detectRedFlags()` |
| `search_icd10_codes` | `handleSearchIcd10Codes` | `knowledge-service.searchIcd10Codes()` |
| `search_cpt_codes` | `handleSearchCptCodes` | `db.searchCptCodes()` |
| `search_hcpcs_codes` | `handleSearchHcpcsCodes` | `knowledge-service.searchHcpcsCodes()` |
| `suggest_codes_from_symptoms` | `handleSuggestCodesFromSymptoms` | `knowledge-service.getCodeCandidates()` (RAG) |
| `validate_code_pair` | `handleValidateCodePair` | `knowledge-service.validateCodePair()` |
| `get_code_pricing` | `handleGetCodePricing` | `fee-schedule-service` |
| `check_payer_guidelines` | `handleCheckPayerGuidelines` | `fee-schedule-service` |

### 4.3 Dynamic Variables (Call Context)

Set when the call is registered; used by tools:

| Variable | Purpose |
|----------|---------|
| `clinic_id` | Tenant, calendar, slots, checkout, credits |
| `merchant_id` | Checkout, products |
| `patient_id` | Patient context (when recognized) |
| `patient_name` | Booking, checkout |
| `has_insurance` | Context for copay/eligibility |

---

## 5. Payment for Appointments

### 5.1 Two Payment Systems

| System | Purpose | Status |
|--------|---------|--------|
| **Circle API** | USDC transfers for insurance claims | ✅ Implemented |
| **Stripe / Link** | Card payments for appointments, products | ✅ Link-based working |

### 5.2 Appointment → Payment Flow

```
1. schedule_appointment (voice) → POST /voice/appointments/schedule
   └─ Creates appointment (pending confirmation)
   
2. create_appointment_checkout → POST /voice/appointments/checkout
   └─ Creates checkout tied to appointment_id
   └─ Amount from: visit_pricing (clinic + appointment_type), or eligibility

3. create_checkout (products) OR link-based flow:
   └─ POST /voice/checkout/create
   └─ Sends verification code to email
   └─ Patient verifies → gets payment link
   
4. Patient pays:
   └─ Stripe (card) or Circle wallet (USDC)
   └─ POST /voice/checkout/complete/:checkout_id
   
5. Appointment auto-confirmed:
   └─ BookingService.confirmAppointment() after successful payment
```

### 5.3 Key Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /voice/appointments/schedule` | Create appointment (name, phone, email, date, time, clinic) |
| `POST /voice/appointments/checkout` | Create checkout for an appointment (copay) |
| `POST /voice/checkout/create` | Create checkout (product or appointment); sends verification code |
| `POST /voice/checkout/verify` | Verify email code, return payment URL |
| `POST /voice/checkout/complete/:id` | Complete payment (Stripe or wallet) |

### 5.4 Amount Resolution

1. Eligibility/copay (when `patient_id` + `payer_id` available)
2. `visit_pricing` table (clinic + appointment_type)
3. Surge pricing when enabled
4. Fallback default ($69)

### 5.5 Payment Methods

- **Link-based**: Email verification → link → Stripe Checkout
- **Wallet**: USDC via Circle (when patient has wallet)
- **Direct Stripe**: Payment Intent (TODO for voice commerce)

---

## 6. Quick Reference: Connect Colab RAG

1. Implement in Colab:
   - `POST /retrieve` or `POST /api/retrieve` (request/response as above)
   - `GET /health`

2. Configure `.env`:
   ```env
   COLAB_RAG_URL=http://localhost:5000    # Or your Colab URL
   RAG_API_URL=http://localhost:4000/api/rag   # Use proxy
   ```

3. Restart middleware.

4. Test: `curl http://localhost:4000/api/rag/health`

5. Verify logs: `📚 Colab RAG: N ICD-10, M CPT candidates` when codes are suggested during a voice call.

---

## 7. Middleware Platform Orchestration

The **middleware platform** (`middleware-platform/server.js` and services) is the central orchestration layer. It does not run the voice agent (Retell does). Instead, it:

1. **Exposes HTTP/WebSocket endpoints** that Retell calls
2. **Routes tool invocations** to the correct services
3. **Persists state** (FHIR, claims, appointments, checkout) in SQLite/Postgres
4. **Orchestrates cross-cutting flows** (eligibility → claim → EOB → settlement)

### 7.1 Middleware ↔ Voice Agent

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  RETELL (Voice Agent)                                                                     │
│  - ASR, LLM, TTS, tool routing                                                            │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                    WebSocket (wss://.../retell-llm) + HTTP (Twilio → /voice/incoming)
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  MIDDLEWARE PLATFORM                                                                      │
│  ┌───────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌───────────────────────┐   │
│  │ retell-       │  │ server.js       │  │ routes/         │  │ services/             │   │
│  │ websocket.js  │  │ (HTTP routes)  │  │ voice.js,       │  │ knowledge-service,    │   │
│  │               │  │                │  │ rag-proxy,      │  │ triage-service,       │   │
│  │ Tool handlers │  │ /voice/*,      │  │ fhir.js,        │  │ fhir-service,        │   │
│  │ → services    │  │ /api/*         │  │ payment.js,     │  │ booking-service,     │   │
│  └───────────────┘  └─────────────────┘  └─────────────────┘  └───────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  database.js (SQLite / Postgres)                                                          │
│  fhir_patients, fhir_encounters, appointments, insurance_claims, eligibility_checks,       │
│  voice_call_states, voice_conversation_memory, voice_checkouts                            │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Middleware ↔ Billing Mechanisms

| Billing Flow | Middleware Role | Services Involved |
|--------------|-----------------|-------------------|
| **Patient copay** | Creates checkout, verifies email, completes payment | `server.js` routes, PaymentOrchestrator, Stripe/Circle |
| **Insurance claim** | Submits X12 837, checks status, stores claim | InsuranceService, Stedi API |
| **EOB / pre-adjudication** | Calculates patient responsibility from eligibility + fee schedule | EOBCalculationService, FeeScheduleService |
| **Settlement** | Decides full/partial/hold from coding confidence | SettlementService, EscrowOrchestratorService |
| **Invoice** | Creates invoice from claim | InvoiceService |

Middleware **does not** hold insurance credentials or payment cards; it orchestrates API calls (Stedi, Stripe, Circle) and persists results.

---

## 8. Billing Agent Main Functionality

The “billing agent” is the set of voice tools and backend services that handle medical coding, pricing, eligibility, claims, and settlement. It is **not** a separate agent; it is embedded in the voice agent via tools.

### 8.1 Core Functions

| Function | Purpose |
|----------|---------|
| **assess_urgency** | Triage before scheduling or coding; blocks scheduling for emergencies |
| **search_icd10_codes / search_cpt_codes / search_hcpcs_codes** | Look up codes by keyword during the call |
| **suggest_codes_from_symptoms** | One-shot: patient describes symptoms → ICD-10 + CPT candidates (RAG + local) |
| **validate_code_pair** | Ensure ICD-10 + CPT are compatible and exist; logs to `coding_decisions` |
| **check_payer_guidelines** | Check if payer has fee schedule in DB |
| **get_code_pricing** | Return allowed amounts for CPT codes from `fee_schedules` |
| **collect_insurance** | Collect member_id, payer; run eligibility; store in `patient_insurance` |
| **create_appointment_checkout** | Create checkout for appointment copay |

### 8.2 Claim Lifecycle (Insurance Billing)

```
1. ELIGIBILITY
   Voice: collect_insurance → POST /voice/insurance/collect
   → PayerCacheService.validatePatientInsurance
   → InsuranceService.checkEligibility (Stedi 270/271)
   → db.createEligibilityCheck
   → Return: { eligible, copay, allowed_amount, insurance_pays, deductible_total, ... }

2. CLAIM SUBMISSION
   API: POST /voice/insurance/submit-claim
   → InsuranceService.submitClaim (Stedi 837)
   → db.createInsuranceClaim
   → Optional: FHIRService.createCardForBill/copay if patient owes

3. PRE-ADJUDICATION (real-time)
   API: GET /api/claims/:claimId/pre-adjudicate
   → AdjudicationService.runAdjudication
   → EOBCalculationService.calculateEOBFromClaim (uses fee schedule when payer + CPT present)
   → SettlementService.getSettlementDecision (coding confidence → full/partial/hold)

4. CLAIM STATUS
   Voice/API: check_claim_status → InsuranceService.checkClaimStatus (Stedi 276/277)

5. POST-ADJUDICATION
   When claim approved/paid: ReconciliationService compares real_time_plan_paid vs final
   → Release additional, recover, or flag for manual
```

### 8.3 EOB and Settlement

- **EOB**: `EOBCalculationService` computes allowed amount, plan paid, deductible, copay, coinsurance from eligibility + fee schedule.
- **Settlement**: `SettlementService.getSettlementDecision()` uses aggregate coding confidence Φ to decide:
  - **full**: Release R_plan (Φ ≥ θ_high)
  - **partial**: Release R_plan × Φ (θ_low ≤ Φ < θ_high)
  - **hold**: Release 0, escrow R_plan (Φ < θ_low)

---

## 9. Medical Reasoning → Billing Interaction

Medical reasoning (coding, triage) directly drives billing behavior.

### 9.1 Coding → Pricing

```
suggest_codes_from_symptoms (or search_*_codes)
    │
    ▼
getCodeCandidates() / getCandidatesForCoding()
    │
    ├─ Colab RAG (when RAG_API_URL set)
    └─ Local keyword + phrase search
    │
    ▼
Returns: { icd10, cpt, hcpcs } with { code, description, confidence }
    │
    ▼
get_code_pricing(cpt_codes, payer_id)
    │
    ▼
FeeScheduleService.getAllowedAmountsForCodes(payer_id, cpt_codes)
    │
    ▼
fee_schedules table → allowed_amount per (payer_id, cpt_code)
    │
    ▼
EOBCalculationService uses allowed amounts for line items
```

### 9.2 Coding Confidence → Settlement

- **Settlement confidence** Φ is derived from per-code confidence (φ_i) from the coding pipeline.
- `SettlementRulesService.evaluateSettlementRules()` uses `codingBand` and `codingConfidence` from `claimDetails`.
- Low confidence → manual review or partial release; high confidence → auto-approve.

### 9.3 Triage → Scheduling

- `assess_urgency()` returns EMERGENT / URGENT / ROUTINE.
- `handleScheduleAppointment()` calls `checkBeforeScheduling(recentTurns)`.
- If EMERGENT: scheduling blocked; agent instructs caller to call 911 / go to ER.

---

## 10. FHIR Resources & Data Flow

FHIR resources are **stored locally** in SQLite (or Postgres), not in Azure Healthcare FHIR. The platform uses FHIR R4-compliant structures for interoperability.

### 10.1 Storage

| Table | Resource | Purpose |
|-------|----------|---------|
| `fhir_patients` | Patient | Demographics, phone, email, `patient_wallet_address`, `merchant_id` |
| `fhir_encounters` | Encounter | Voice/video encounters; `call_id`, `patient_id`, `start_time`, `status` |
| `fhir_communications` | Communication | Call transcripts (encounter_id → messages) |
| `fhir_observations` | Observation | Assessments (PHQ-9, GAD-7, etc.) |
| `fhir_diagnostic_reports` | DiagnosticReport | Video consult AI assessments |

### 10.2 Voice Call → FHIR Flow

```
Twilio receives call → POST /voice/incoming
    │
    ├─ Immediate: Return TwiML (Dial to Retell SIP)
    │
    └─ setImmediate (async, non-blocking):
          │
          ▼
      FHIRAdapter.retellCallToFHIR({ call_id, from_number, to_number, metadata })
          │
          ▼
      FHIRService.processVoiceCall(callData)
          │
          ├─ getOrCreatePatient (by phone) → fhir_patients
          │
          └─ createEncounter ({ patientId, callId, ... }) → fhir_encounters
```

- **Patient**: Created or looked up by phone; `call_id` is associated via encounter.
- **Encounter**: Links `Patient`, `call_id`, timestamps; `call_id` stored in extension.

### 10.3 FHIR ↔ Appointments & Claims

- **Appointments**: `BookingService.scheduleAppointment()` calls `FHIRService.getOrCreatePatient()`; `appointments.patient_id` = `fhir_patients.resource_id`.
- **Claims**: `insurance_claims.patient_id` references `fhir_patients.resource_id`.
- **Eligibility**: `eligibility_checks.patient_id` references `fhir_patients.resource_id`.
- **Benefits**: `GET /api/patients/:patientId/benefits` joins `fhir_patients`, `patient_insurance`, `eligibility_checks`.

### 10.4 FHIR Resource Creation (Templates)

- `models/fhir-resources.js`: `createPatient()`, `createEncounter()`, `createCommunication()`, `createObservation()`.
- Output is HL7 FHIR R4 JSON; stored in `resource_data` (JSON) in DB.

---

## 11. Azure Domain Services

**Naming clarification**: “Azure Domain Services” in this codebase refers to **`AzureDomainService`** (`middleware-platform/services/azure-domain-service.js`), which manages **custom domains and SSL** for tenant subdomains on **Azure App Service**. It is **not** Azure Healthcare FHIR Service or Azure Active Directory Domain Services.

### 11.1 What AzureDomainService Does

| Function | Purpose |
|----------|---------|
| `addCustomDomain(subdomain, rootDomain, appName, resourceGroup)` | Add `{subdomain}.doclittle.site` to Azure App Service |
| `createSSLCertificate(...)` | Create managed SSL certificate for subdomain |
| `bindSSLCertificate(...)` | Bind certificate to domain |
| `setupTenantDomain(subdomain)` | End-to-end: domain + SSL for new tenant |

### 11.2 When It Runs

- On tenant signup: `setupTenantDomain(tenantSubdomain)`.
- Requires Azure CLI and `AZURE_APP_NAME`, `AZURE_RESOURCE_GROUP`, `AZURE_ROOT_DOMAIN`.

### 11.3 Relationship to FHIR

- **FHIR** is stored in local DB (`fhir_patients`, `fhir_encounters`, etc.).
- **Azure** hosts the middleware app (App Service); `AzureDomainService` configures `tenant.doclittle.site` → that app.
- There is no Azure Healthcare FHIR integration in the current codebase.

---

## 12. Related Documentation

| Document | Contents |
|----------|----------|
| `docs/architecture/financial/FINANCIAL_LAYER_ARCHITECTURE.md` | Full financial layer, Stedi, coding pipeline, Tiba spec |
| `docs/architecture/voice-agent/STATE_FLOW.md` | Medical coding state machine |
| `docs/architecture/voice-agent/VOICE_AGENT_TODO_AND_STATUS.md` | Implementation status |
| `docs/middleware-platform/VOICE_AGENT_FUNCTIONS_AND_DYNAMIC_VARIABLES.md` | Voice tools and dynamic variables |
| `todos/PRODUCTION_READINESS_TASKS.md` | Production readiness checklist, Azure setup, compliance |

- [FINANCIAL_LAYER_ARCHITECTURE.md](./financial/FINANCIAL_LAYER_ARCHITECTURE.md) — Stedi, coding pipeline, EOB, settlement, voice tools
- [STATE_FLOW.md](./voice-agent/STATE_FLOW.md) — Medical coding state machine
- [VOICE_AGENT_FUNCTIONS_AND_DYNAMIC_VARIABLES.md](../middleware-platform/VOICE_AGENT_FUNCTIONS_AND_DYNAMIC_VARIABLES.md) — All Retell functions and dynamic variables
- [PRODUCTION_READINESS_TASKS.md](../../todos/PRODUCTION_READINESS_TASKS.md) — Tasks to be production-ready, including Azure setup
