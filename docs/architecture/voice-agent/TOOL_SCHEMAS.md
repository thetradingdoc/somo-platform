# Medical Coding Voice Agent – Tool Schemas & Usage

Reference for Retell function calls used during medical coding voice conversations.

---

## Medical Coding Tools

### search_icd10_codes

Look up ICD-10 diagnosis codes by symptom, condition, or code prefix.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Symptom, condition name, or ICD-10 code (e.g. "diabetes", "E11.9") |
| `limit` | number | No | Max results (default 10) |

**When to call**: Caller mentions a diagnosis or symptom; need codes for billing.

**Returns**: `{ code, description, category }[]`

---

### search_cpt_codes

Look up CPT procedure codes by procedure name or code.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Procedure name or CPT code (e.g. "office visit", "99213") |
| `limit` | number | No | Max results (default 10) |

**When to call**: Caller mentions a service/procedure; need codes for billing.

**Returns**: `{ code, description, category, subcategory }[]`

---

### search_hcpcs_codes

Look up HCPCS Level II (supplies, DME, drugs, modifiers).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Procedure, supply, modifier, or HCPCS code (e.g. "wheelchair", "E0601") |
| `limit` | number | No | Max results (default 10) |

**When to call**: DME, supplies, injectable drugs, modifiers not in CPT.

**Returns**: `{ code, description, short_desc, type }[]`

---

### suggest_codes_from_symptoms

Get suggested ICD-10 and CPT codes from patient's description of symptoms or reason for visit. Returns top codes with patient-friendly descriptions and pre-validated ICD-10+CPT pairs.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `clinical_text` | string | Yes | Patient description (e.g. "type 2 diabetes follow-up", "anxiety and depression") |
| `max_icd10` | number | No | Max ICD-10 codes (default 5) |
| `max_cpt` | number | No | Max CPT codes (default 5) |

**When to call**: Patient describes condition; need codes for billing.

**Returns**: `{ icd10: [{ code, description, patient_friendly }], cpt: [...], validated_pairs: [{ icd10_code, cpt_code, valid, reason }] }`

---

### extract_medical_text

Extract structured medical data from patient utterance: symptoms, vitals, severity, temporal info.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `patient_utterance` | string | Yes | Patient's spoken description of symptoms |

**When to call**: Patient describes symptoms; need structured data for triage or coding.

**Returns**: `{ symptoms: string[], vitals: { temperature?, systolic?, diastolic?, heart_rate? }, severity: string|null, temporal: { duration_days?, acuteness?, ... } }`

---

### assess_urgency

Triage patient symptoms: EMERGENT, URGENT, or ROUTINE.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `symptoms_text` | string | Yes | Patient description of symptoms |

**When to call**: Before scheduling or coding; caller describes symptoms.

**Returns**: `{ urgency: "EMERGENT"|"URGENT"|"ROUTINE", isEmergency, suggestedResponse }`

---

### validate_code_pair

Check ICD-10 + CPT compatibility for billing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `icd10_code` | string | Yes | ICD-10 code (e.g. "E11.9") |
| `cpt_code` | string | Yes | CPT code (e.g. "99213") |

**When to call**: Before finalizing coding suggestions.

**Returns**: `{ valid: boolean, reason?: string }`

---

### check_payer_guidelines

Check if payer has fee schedule/guidelines.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `payer_id` | string | Yes | Payer ID (BCBS, AETNA, UHC) |
| `payer_name` | string | No | Payer name if payer_id unknown |

**When to call**: Before quoting prices; caller asks about insurance coverage.

**Returns**: `{ hasFeeSchedule: boolean }`

---

### get_code_pricing

Get allowed amounts for CPT codes from payer fee schedule.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `payer_id` | string | Yes | Payer ID |
| `cpt_codes` | string[] | Yes | CPT codes (e.g. ["99213","99214"]) |
| `date_of_service` | string | No | YYYY-MM-DD |

**When to call**: Caller asks about pricing or patient responsibility.

**Returns**: `{ [cptCode]: allowedAmount }`

---

## Suggested Workflow

1. **assess_urgency** → If EMERGENT, advise 911; do not schedule.
2. **suggest_codes_from_symptoms** (preferred) or **search_icd10_codes** + **search_cpt_codes** → Get candidates. Use `validated_pairs` from suggest when presenting.
3. **validate_code_pair** → Only when combining codes from separate searches; `suggest_codes_from_symptoms` returns pre-validated pairs.
4. **check_payer_guidelines** → If caller has insurance and needs pricing.
5. **get_code_pricing** → For allowed amounts per code. Offer after suggesting codes: "Would you like me to check your insurance for the copay?"

---

*Source: retell-functions.json. See RUNBOOK.md for operational details.*
