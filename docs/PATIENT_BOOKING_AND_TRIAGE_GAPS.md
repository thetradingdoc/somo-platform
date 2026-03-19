# Patient Booking & Triage — Consolidated Gaps & Flow

**Last Updated:** March 2026

Consolidated document merging content from: Patient Booking & Journey, Triage & Matching Gaps, Specialist Matching Plan, Clinical Marketplace Todos.

---

## 1. Current Flow (As Implemented)

### Entry Points

- **Route**: `POST /api/patient/triage/message` (server.js → `handlePatientTriageMessage`)
- **Frontend**: `unified-dashboard/patients/triage.html` (chat UI with Kelly)
- **Auth**: Patient session required (`x-session-id`, validated via `PatientPortalService`)

### Primary: Kelly LLM (kelly-agent-service.js)

When `KELLY_LLM_ENABLED` and Groq/OpenAI keys are set, the flow uses Kelly with tools.

**Triage tools (OPQRST + RAG):**
- `get_triage_session` — Get stored OPQRST from triage_sessions; call before `run_triage_rag`
- `store_triage_opqrst` — Store onset, provocation, quality, radiation, severity, timing, associated_sx
- `run_triage_rag` — Analyze symptoms → specialty, urgency, safety_level; **required before slots**

**Booking tools:**
- `get_available_slots` — **Blocked until** `run_triage_rag` succeeds and `rag_confidence` ≥ 0.7
- `schedule_appointment` — Requires `practitioner_id` from chosen slot
- `collect_insurance` — **Blocked until** triage; uses RAG CPT code, not default 90834
- `create_appointment_checkout` — After schedule
- `verify_checkout_code` — Patient provides 6-digit email code

**Other:** `search_appointments`, `get_patient_claims`, `request_document_upload`, `end_call`

**Phases (Kelly prompt):**
1. **TRIAGE** — Collect OPQRST; call `run_triage_rag` to get specialty, urgency, safety
2. **LANE** — Offer Video Now (sync) vs Async Review; severity ≥8 must use sync
3. **INSURANCE** — `collect_insurance` after triage (uses RAG CPT)
4. **SLOTS** — `get_available_slots` (requires triage first)
5. **SCHEDULE** — `schedule_appointment` with `practitioner_id` from slot
6. **CHECKOUT** — `create_appointment_checkout` → email code → `verify_checkout_code`

**Skip triage:** When user says "I want to book", "just book", "checkup", "routine visit" → go to LANE, then slots with `PrimaryCare` or `General Consult`.

### Fallback: Patient Orchestrator

Used when Kelly LLM fails (rate limit, etc.) or `KELLY_LLM_ENABLED=0`. Uses RAG for intent and OPQRST dialogue; different tool set.

---

## 2. Golden Path (Target Architecture)

```
Kelly (voice/chat)
    │
    ▼
OPQRST Triage + Red Flag Check
    │
    ├── RED (urgent/emergency) ──► 911 script, bypass all matching
    │
    └── YELLOW / GREEN
            │
            ▼
        RAG Translation Layer
        Input: "fluttery heart, chest tightness"
        Output: { icd, specialty, urgency, safety_level }
            │
            ▼
        SpecialistResolverService
        Input: (specialty, language, location, lane, urgency)
        Output: Map<provider_id, attributes>
            │
            ▼
        getAvailableSlots (loops resolver output)
        Output: [{ time, practitioner_id, language, price_tier, lane }]
            │
            ▼
        Kelly presents slot + specialist context
            │
            ▼
        schedule_appointment(practitioner_id REQUIRED)
```

**Shift:** Patient → Symptoms → RAG resolves specialty+urgency → Resolver finds specialists → Slots bundled to provider → Lock booking.

---

## 3. What's Solid ✅

| Area | Status |
|------|--------|
| Language detection | Works — Swahili/Spanish/French fires before LLM |
| Emergency pre-check | `detectRedFlags` runs before Groq, hard stop |
| Insurance + booking tools | Wired correctly |
| V-1 bug | Fixed in KellyToolExecutor (patient_id → claims) |
| Schema | prescriptions, provider_profiles, triage_sessions, daily_quota, media exist |
| Slots blocked until triage | get_available_slots requires run_triage_rag + rag_confidence ≥ 0.7 |

---

## 4. All Gaps (Consolidated)

### 4.1 Triage Gaps (T)

| ID | Gap | Priority |
|----|-----|----------|
| **T1** | OPQRST has no enforced sequence — LLM decides when to ask/skip; no state machine | Fix 1 |
| **T2** | `run_triage_rag` was optional — now blocked at slots, but prompt/tool guard should reinforce | Fix 1 |
| **T3** | No specialty-specific follow-up (cardiac: prior episodes, family history; derm: spreading, products; psych: PHQ-2, safety) | Fix 3 |
| **T4** | Document upload has no pause-resume — uploaded file never influences next question | — |
| **T5** | Severity 1–10 not fully used as routing gate — ≥8 should escalate (partially done) | — |
| **T6** | Mental health intake wrong — OPQRST radiation doesn't fit; need PHQ-2/GAD-2, safety screen | — |

### 4.2 Matching Gaps (M)

| ID | Gap | Impact / Priority |
|----|-----|-------------------|
| **M1** | Standard path returns clinic-wide slots when SpecialistResolver has no providers | No `practitioner_id`; double-booking risk. Need to wire resolver. |
| **M2** | `_checkSlotAvailability` ignores `practitioner_id` | Conflicts checked clinic-wide, not per-provider |
| **M3** | Kelly must pass `practitioner_id` from slot when scheduling | If omitted, specialist matching doesn't translate to booking |
| **M4** | Date/timezone edge cases in available-slots | Wrong date slots returned (e.g. 2024 vs 2026) |
| **M5** | Standard path slot_bundles lack `practitioner_id` | Inconsistent format; Kelly can't get practitioner for fallback path |
| **M6** | Zero rows in `provider_profiles` — resolver returns empty Map | Seed 2–3 rows |
| **M7** | `kellyScript` from resolver (filter decay) never reaches LLM | — |
| **M8** | Patient `price_tier` not passed → load balancing inactive | — |
| **M9** | Async vs sync UX script missing — no "4 hours/$40 vs live/$80" offer | — |

### 4.3 Schedule Gaps (S)

| ID | Gap | Impact |
|----|-----|--------|
| **S1** | Duplicate patient detection blocks schedule | Patient cannot book if name matches existing but contact differs |
| **S2** | Insurance 409 blocks flow | User asked for insurance, then blocked; unclear next step |
| **S3** | No practitioner-scoped conflict check | Overly strict; reduces capacity |
| **S4** | Name mismatch warning but schedule continues | Possible wrong patient linkage |

### 4.4 Checkout Gaps (C)

| ID | Gap | Impact |
|----|-----|--------|
| **C1** | Clinic has no `merchant_id` | Checkout fails |
| **C2** | Auto-checkout 10s timeout | Can fail when email send is slow |
| **C3** | Invalid `appointment_id` accepted | Orphaned checkouts; payment link may not match |
| **C4** | No `ensureMerchantForClinic` fallback in checkout | Single-tenant clinics blocked |

### 4.5 Supporting / UX Gaps (U)

| ID | Gap | Impact |
|----|-----|--------|
| **U1** | Document upload fails (ENOENT, etc.) | Patient cannot attach photos for triage |
| **U2** | Groq 429 rate limit | Fallback to Orchestrator; rate-limit message helps but doesn't unblock |
| **U3** | SMS fails for test numbers | Dev/testing cannot receive SMS |
| **U4** | Chips persist after conversation starts | UX clutter |
| **U5** | "10 am" → "I'm not sure how to respond" | LLM fails to map time to `schedule_appointment` |
| **U6** | `verify_checkout_code` 400 | Wrong params, expired code, or invalid token |
| **U7** | `eligibilityChecks is not defined` | Checkout path error |

---

## 5. Gap List (gap1–gap18) — Implementation Tasks

### Original (gap1–gap10)

| ID | Task |
|----|------|
| gap1 | Enforce OPQRST state machine: triage_state, block slots until run_triage_rag |
| gap2 | Wire SpecialistResolver + getAvailableSlotsWithSpecialist into KellyToolExecutor |
| gap3 | Seed provider_profiles: 2–3 rows |
| gap4 | Feed kellyScript (filter decay) back into LLM context |
| gap5 | Pass patient price_tier to get_available_slots |
| gap6 | Specialty-specific deep-dive questions in Kelly prompt |
| gap7 | Severity ≥8 as routing gate: force urgency, restrict async |
| gap8 | Mental health intake: PHQ-2/GAD-2, safety screen |
| gap9 | Async vs Sync UX script in prompt |
| gap10 | Document upload pause-resume: halt, wait, feed image into RAG |

### Triage-specific (gap11–gap14)

| ID | Task | Why it's missing |
|----|------|------------------|
| gap11 | Store OPQRST fields in `triage_sessions` as Kelly collects them (per-turn upsert) | Table exists, writes added but prompt/tool flow can improve |
| gap12 | Before `run_triage_rag`: Kelly assembles OPQRST from session state — add explicit prompt instruction | Tool expects structured input but Kelly may pass incomplete |
| gap13 | Add `rag_confidence` to run_triage_rag response; prompt rule: <0.7 → ask one more question | Done; reinforce in prompt |
| gap14 | Auto-generate SOAP note from triage_sessions after triage_complete = true | Done (gap14 in triage-rag-service) |

### Matching-specific (gap15–gap17)

| ID | Task |
|----|------|
| gap15 | Delay insurance collection until specialty known from RAG; use RAG CPT code |
| gap16 | Call `SpecialistResolverService.cleanupCache()` on server startup + every 60 min |
| gap17 | Add unique DB constraint on `(practitioner_id, start_time, status)` |

### Session/Context (gap18)

| ID | Task |
|----|------|
| gap18 | Persist detected language to session; read from there instead of re-detecting each turn |

---

## 6. Specialist Matching Architecture (Condensed)

### Shift: Clinics → Specialists

- **Specialist** = primary booking entity (provider_profile, availability_blocks)
- **Clinic** = optional grouping (merchant_id)

### Matching Pipeline

1. **Patient context:** Reason/symptoms → RAG → ICD-10 → implied_specialty. Urgency, preferred_language, date.
2. **SpecialistResolverService:** Filter by specialty, language, lane, urgency → Map<provider_id, attributes>
3. **getAvailableSlots:** Accept practitioner_ids from resolver; return slots with practitioner_id per slot
4. **schedule_appointment:** Require practitioner_id from chosen slot

### Files to Touch

- `kelly-tool-executor.js` — SpecialistResolver + getAvailableSlotsWithSpecialist
- `booking-service.js` — practitioner_ids in getAvailableSlots; practitioner-scoped conflict check
- Kelly prompt — specialist-centric language; always pass practitioner_id from slot

---

## 7. Phased Execution (Clinical Marketplace)

| Phase | Focus |
|-------|-------|
| **Foundation** | prescription table, provider_profile schema, media_attachments, patient price_tier, specialist_daily_quota |
| **Triage** | RAG specialty/safety_level, OPQRST flow, red flag gate, document upload pause-resume |
| **Matching** | SpecialistResolverService, getAvailableSlots by provider list, load balancing, practitioner_id required |
| **Kelly** | LLM migration, tool executor, prompt + emergency pre-check, wire to voice and chat |
| **Prescription** | Write on case report completion, view in portal, SOAP auto-generation |

---

## 8. Recommended Fixes (Priority)

### P0 – Unblock Checkout

- **C1/C4**: Use `ensureMerchantForClinic(clinic)` when `clinic.merchant_id` is null
- **C2**: Increase auto-checkout timeout or make fire-and-forget

### P1 – Fix Matching & Schedule

- **M2/S3**: Pass `practitioner_id` to `_checkSlotAvailability`
- **M3**: Strengthen Kelly prompt to always pass `practitioner_id` from slot
- **M1/M6**: Wire SpecialistResolver; seed provider_profiles

### P2 – Duplicate & Insurance

- **S1**: Return clear `voice_agent_instruction` on duplicate; ask for confirmation
- **S2**: On insurance 409, Kelly asks for phone/email confirmation, not abort

### P3 – Consistency

- **M4**: Audit date handling and cache keys
- **C3**: Validate `appointment_id` exists before creating checkout

---

## 9. Related Documentation

- **[GAP_ANALYSIS_RICHER_TRIAGE_AND_RECORDS.md](./GAP_ANALYSIS_RICHER_TRIAGE_AND_RECORDS.md)** — Richer triage schema (family history, meds), patient records Q&A
- **[architecture/patients/PATIENT_ARCHITECTURE.md](./architecture/patients/PATIENT_ARCHITECTURE.md)** — 9-step patient booking flow
