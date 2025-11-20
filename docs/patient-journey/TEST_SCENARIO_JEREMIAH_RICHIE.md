# Complete Patient Journey Test Scenario
## Patient: Jeremiah Richie

**Status**: ✅ **YES - I UNDERSTAND THE FULL JOURNEY**

---

## 🎯 Test Scenario Overview

This document outlines the complete end-to-end patient journey test for **Jeremiah Richie** using STEDI test patient data.

### Journey Flow:
1. ✅ Create patient: Jeremiah Richie (using STEDI test data)
2. ✅ Patient searches/sees insurance balance & coverage
3. ✅ Patient books appointment via voice agent
4. ✅ Copay features in patient wallet
5. ✅ Provider uploads medical records to provider portal
6. ✅ System finds medical codes (CPT codes)
7. ✅ Create invoice with medical codes
8. ✅ Send invoice/claim to insurer
9. ✅ Accept claim on insurer portal
10. ✅ Patient sees what they owe after appointment in patient wallet

---

## 📋 Step-by-Step Test Plan

### **STEP 1: Get STEDI Sandbox Test Data Structure**

**Goal**: Understand STEDI Sandbox data structure that's connected to Retell agent

**Terminal Commands**:
```bash
cd middleware-platform
node scripts/list-stedi-patients.js
```

**Expected Output**:
- Sample STEDI patient data structure
- Insurance information format
- Coverage details format
- Member ID format
- Payer ID format

**What to Capture** (STEDI Sandbox Data Structure):
- Patient name format
- Date of birth format
- Phone number format
- Email format
- `member_id` - Insurance member ID format (e.g., `TEST123456`)
- `payer_id` - Insurance company (e.g., `BCBS`, `AETNA`, `UHC`)
- `service_code` - CPT code (e.g., `90834`)
- `copay_amount` - Patient copay
- `allowed_amount` - Total allowed by insurance
- `insurance_pays` - Amount insurance covers
- `deductible_remaining` - Remaining deductible

---

### **STEP 2: Create Patient "Jeremiah Richie" in Provider Dashboard**

**Goal**: Create NEW patient "Jeremiah Richie" using STEDI Sandbox data structure

**Terminal Commands**:
```bash
# Create patient via FHIR Patient endpoint (used by provider dashboard)
curl -X POST https://api.doclittle.site/fhir/Patient \
  -H "Content-Type: application/json" \
  -d '{
    "resourceType": "Patient",
    "name": [{
      "use": "official",
      "family": "Richie",
      "given": ["Jeremiah"]
    }],
    "telecom": [
      {
        "system": "phone",
        "value": "+15551234567",
        "use": "mobile"
      },
      {
        "system": "email",
        "value": "jeremiah.richie@example.com"
      }
    ],
    "gender": "male",
    "birthDate": "1985-06-15",
    "address": [{
      "use": "home",
      "line": ["123 Main Street"],
      "city": "New York",
      "state": "NY",
      "postalCode": "10001",
      "country": "US"
    }]
  }'
```

**Expected Output**:
- Patient created successfully
- Patient ID returned
- Patient record in FHIR format

**Capture**:
- `patient_id` or `resource_id` - Will use this for all subsequent steps

---

### **STEP 3: Add STEDI Sandbox Insurance Data to Patient**

**Goal**: Link STEDI Sandbox insurance data to Jeremiah Richie (using STEDI test data structure)

**Terminal Commands**:
```bash
# Collect insurance (using STEDI Sandbox test data structure)
curl -X POST https://api.doclittle.site/voice/insurance/collect \
  -H "Content-Type: application/json" \
  -d '{
    "patient_name": "Jeremiah Richie",
    "patient_phone": "+15551234567",
    "patient_email": "jeremiah.richie@example.com",
    "member_id": "TEST123456",
    "payer_name": "Cigna",
    "payer_id": "CIGNA",
    "service_code": "90834",
    "date_of_birth": "1985-06-15",
    "patient_id": "{patient_id_from_step_2}"
  }'
```

**Expected Output**:
- Insurance collected and verified
- Eligibility check created
- Coverage details returned:
  - `copay_amount`: $20.00
  - `allowed_amount`: $150.00
  - `insurance_pays`: $130.00
  - `patient_responsibility`: $20.00
  - `deductible_remaining`: (if applicable)
  - `coinsurance_percent`: (if applicable)

**Capture**:
- `insurance_id`
- `eligibility_id`
- `member_id`: `TEST123456`
- `payer_id`: `CIGNA`
- Coverage amounts

**Verify Patient Record**:
```bash
# Get patient with insurance
curl https://api.doclittle.site/api/patient/{patient_id}
```

---

### **STEP 3: Patient Views Insurance Balance & Coverage**

**Goal**: Patient can see their insurance balance, copay, deductible remaining

**Terminal Commands**:
```bash
# Get patient eligibility/coverage
curl https://api.doclittle.site/api/patient/{patient_id}/benefits

# Get patient insurance balance
curl https://api.doclittle.site/api/patient/{patient_id}/insurance/balance
```

**Expected Output**:
- Current coverage status
- Copay amount
- Deductible remaining
- Coinsurance percentage
- Allowed amounts
- Patient responsibility

**Test Patient Wallet Balance**:
```bash
# Check patient wallet (if Circle wallet exists)
curl https://api.doclittle.site/api/patient/{patient_id}/wallet/balance
```

---

### **STEP 4: Patient Books Appointment via Voice Agent**

**Goal**: Book appointment for Jeremiah Richie

**Terminal Commands**:
```bash
# Book appointment
curl -X POST https://api.doclittle.site/voice/appointments/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "patient_name": "Jeremiah Richie",
    "patient_phone": "+15551234567",
    "patient_email": "jeremiah.richie@example.com",
    "appointment_type": "Therapy Session - Psychiatry",
    "date": "2025-11-25",
    "time": "2:00 PM",
    "timezone": "America/New_York",
    "clinic_id": "test-clinic-id"
  }'
```

**Expected Output**:
- Appointment ID
- Appointment date/time
- Confirmation details
- Appointment status: "scheduled"

**Capture**:
- `appointment_id` - Will use for invoice creation

---

### **STEP 5: Check Copay in Patient Wallet**

**Goal**: Patient sees copay amount in their wallet

**Terminal Commands**:
```bash
# Get patient wallet details
curl https://api.doclittle.site/api/patient/{patient_id}/wallet

# Get pending payments
curl https://api.doclittle.site/api/patient/{patient_id}/wallet/pending
```

**Expected Output**:
- Wallet balance
- Pending copay amount
- Payment due date
- Payment status

---

### **STEP 6: Provider Uploads Medical Records**

**Goal**: Provider uploads visit notes/records to provider portal

**Terminal Commands**:
```bash
# Upload medical record/document
curl -X POST https://api.doclittle.site/api/provider/appointments/{appointment_id}/documents \
  -H "Content-Type: application/json" \
  -d '{
    "document_type": "visit_notes",
    "content": "Patient presented with anxiety symptoms. Discussed treatment options.",
    "diagnosis_codes": ["F41.1"],
    "service_codes": ["90834"]
  }'
```

**Expected Output**:
- Document ID
- Document uploaded
- Linked to appointment
- Diagnosis codes stored
- Service codes (CPT codes) stored

**Capture**:
- `document_id`
- `diagnosis_codes` - ICD-10 codes
- `service_codes` - CPT codes (e.g., 90834 for therapy)

---

### **STEP 7: System Finds Medical Codes**

**Goal**: System extracts/identifies CPT codes and diagnosis codes from records

**Terminal Commands**:
```bash
# Get medical codes for appointment
curl https://api.doclittle.site/api/provider/appointments/{appointment_id}/codes

# Get diagnosis codes
curl https://api.doclittle.site/api/provider/appointments/{appointment_id}/diagnosis
```

**Expected Output**:
- CPT codes: `["90834"]` (Psychotherapy, 45 minutes)
- Diagnosis codes: `["F41.1"]` (Generalized anxiety disorder)
- Code descriptions
- Code amounts

---

### **STEP 8: Create Invoice with Medical Codes**

**Goal**: Create invoice/claim with CPT codes, diagnosis codes, and amounts

**Terminal Commands**:
```bash
# Create invoice/claim
curl -X POST https://api.doclittle.site/api/provider/invoices \
  -H "Content-Type: application/json" \
  -d '{
    "appointment_id": "{appointment_id}",
    "patient_id": "{patient_id}",
    "service_codes": [
      {
        "cpt_code": "90834",
        "description": "Psychotherapy, 45 minutes",
        "quantity": 1,
        "unit_price": 150.00
      }
    ],
    "diagnosis_codes": ["F41.1"],
    "total_amount": 150.00,
    "date_of_service": "2025-11-25"
  }'
```

**Expected Output**:
- Invoice ID
- Invoice number
- Total amount
- Service codes included
- Diagnosis codes included
- Status: "pending_submission"

**Capture**:
- `invoice_id` or `claim_id`

---

### **STEP 9: Send Invoice/Claim to Insurer**

**Goal**: Submit claim to insurance company (STEDI/UHC/etc.)

**Terminal Commands**:
```bash
# Submit claim to insurance
curl -X POST https://api.doclittle.site/api/insurance/claims/submit \
  -H "Content-Type: application/json" \
  -d '{
    "claim_id": "{claim_id}",
    "patient_id": "{patient_id}",
    "member_id": "{member_id}",
    "payer_id": "{payer_id}",
    "appointment_id": "{appointment_id}",
    "service_codes": [{"cpt_code": "90834", "amount": 150.00}],
    "diagnosis_codes": ["F41.1"],
    "date_of_service": "2025-11-25",
    "total_amount": 150.00
  }'
```

**Expected Output**:
- Claim submitted
- Claim ID from insurer
- Submission status: "submitted"
- Estimated processing time

**Capture**:
- `insurance_claim_id`

---

### **STEP 10: Accept Claim on Insurer Portal**

**Goal**: Simulate insurer accepting/processing the claim

**Terminal Commands**:
```bash
# Simulate insurer processing (or check claim status)
curl https://api.doclittle.site/api/insurance/claims/{insurance_claim_id}/status

# If insurer accepts, update claim status
curl -X POST https://api.doclittle.site/api/insurance/claims/{insurance_claim_id}/process \
  -H "Content-Type: application/json" \
  -d '{
    "status": "approved",
    "insurance_pays": 130.00,
    "patient_responsibility": 20.00,
    "copay_amount": 20.00,
    "allowed_amount": 150.00,
    "eob_data": {
      "allowed_amount": 150.00,
      "insurance_pays": 130.00,
      "patient_responsibility": 20.00,
      "copay": 20.00
    }
  }'
```

**Expected Output**:
- Claim status: "approved"
- Insurance pays: $130.00
- Patient responsibility: $20.00
- Copay: $20.00
- EOB (Explanation of Benefits) data

---

### **STEP 11: Patient Sees Balance in Wallet**

**Goal**: Patient wallet shows what they owe after insurance processes claim

**Terminal Commands**:
```bash
# Get patient wallet with updated balance
curl https://api.doclittle.site/api/patient/{patient_id}/wallet

# Get patient's outstanding bills
curl https://api.doclittle.site/api/patient/{patient_id}/bills

# Get patient's payment due
curl https://api.doclittle.site/api/patient/{patient_id}/wallet/payment-due
```

**Expected Output**:
- Outstanding balance: $20.00
- Payment due date
- Bill details:
  - Service: Psychotherapy (90834)
  - Total: $150.00
  - Insurance paid: $130.00
  - Patient owes: $20.00
- Payment options

---

### **STEP 12: Patient Pays from Wallet**

**Goal**: Patient pays the $20.00 copay from their wallet

**Terminal Commands**:
```bash
# Process payment from wallet
curl -X POST https://api.doclittle.site/api/patient/{patient_id}/wallet/pay \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 20.00,
    "bill_id": "{bill_id}",
    "payment_method": "wallet"
  }'
```

**Expected Output**:
- Payment processed
- Wallet balance updated
- Bill marked as paid
- Receipt generated

---

## 🔍 Verification Checklist

After completing all steps, verify:

- [ ] Patient record exists with STEDI data
- [ ] Insurance coverage visible to patient
- [ ] Appointment booked successfully
- [ ] Medical records uploaded
- [ ] CPT codes identified (90834)
- [ ] Diagnosis codes identified (F41.1)
- [ ] Invoice created with codes
- [ ] Claim submitted to insurer
- [ ] Claim accepted by insurer
- [ ] EOB received (Insurance pays $130, Patient owes $20)
- [ ] Patient wallet shows $20.00 balance due
- [ ] Patient can pay from wallet
- [ ] Payment processed successfully

---

## 📊 Expected Data Flow

```
STEDI Eligibility Check
    ↓
Patient Record (FHIR)
    ↓
Appointment Booking
    ↓
Medical Records Upload
    ↓
CPT/Diagnosis Code Extraction
    ↓
Invoice Creation
    ↓
Claim Submission to Insurer
    ↓
Insurer Processing (EOB)
    ↓
Patient Wallet Update ($20.00 due)
    ↓
Patient Payment
    ↓
Payment Confirmation
```

---

## 🧪 Test Data Summary

**Patient**: Jeremiah Richie
- **Source**: STEDI test patient data
- **Insurance**: From STEDI eligibility check
- **Appointment Type**: Therapy Session - Psychiatry
- **CPT Code**: 90834 (Psychotherapy, 45 minutes)
- **Diagnosis Code**: F41.1 (Generalized anxiety disorder)
- **Total Amount**: $150.00
- **Insurance Pays**: $130.00
- **Patient Owes**: $20.00 (copay)

---

## ✅ Ready to Test?

**Answer**: **YES** - I understand the complete journey and have created this test scenario.

**Next Steps**:
1. Run Step 1: Get STEDI patient data
2. Follow each step sequentially
3. Verify data at each stage
4. Document any issues or missing endpoints

**Ready to start testing?** Let me know when you want to begin Step 1!

