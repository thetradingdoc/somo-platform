# Patient Rename & Provider Invoice Editing

## ✅ Patient Rename: "Jeremiah Richie" → "Otieno Jeremiah"

### Current Status:
- **Patient ID**: `patient-a8bd1117-78b4-453d-8a19-e382ca91e41b`
- **Current Name**: Jeremiah Richie
- **Target Name**: Otieno Jeremiah
- **Dashboard Display**: Should show "Hi OJ" (initials from "Otieno" + "Jeremiah")

### Changes Needed:

1. **Update Patient Name in Database**:
   - Update FHIR patient resource name
   - Family: "Otieno"
   - Given: ["Jeremiah"]

2. **Update Dashboard Greeting**:
   - Current: Shows "Hi {firstName}" → "Hi Otieno"
   - Target: Show "Hi OJ" (initials)
   - File: `unified-dashboard/patients/patient-dashboard.html`
   - Line: ~1023 - Modify to use initials instead of first name

3. **Update Appointment**:
   - Update appointment patient_name to "Otieno Jeremiah"
   - Appointment ID: `appt-6cd533e5-afb1-42be-8f13-68b570f58aac`

---

## 📋 My Benefits Section

### Current Implementation:
- **Endpoint**: `GET /api/patient/benefits?patientName={name}`
- **Location**: `unified-dashboard/patients/patient-dashboard.html` (line ~1017)
- **Data Source**: Insurance eligibility checks from STEDI

### What Should Display:
1. **Insurance Coverage**:
   - Payer Name (UnitedHealthcare)
   - Member ID (TEST999888)
   - Eligible Status
   - Copay Amount ($20)
   - Allowed Amount ($150)
   - Insurance Pays ($130)
   - Patient Responsibility ($20)
   - Deductible (if applicable)
   - Coinsurance (if applicable)
   - Plan Summary

2. **Matching Patient & Provider**:
   - Benefits should match the patient's insurance data
   - Provider should see same data in their dashboard
   - Data comes from STEDI eligibility checks linked to patient_id

### Verification:
- ✅ Patient has insurance: `ins_5a93e70f-e26a-4a57-b24b-bddf86341cae`
- ✅ Eligibility check exists with coverage details
- ⚠️ Need to verify My Benefits section displays this data correctly

---

## 🏥 Provider Invoice Editing (Before Sending to Insurer)

### Current Flow:
1. **Claim Creation**:
   - `POST /api/claims/create-from-pdf` - Creates claim from PDF coding data
   - `POST /voice/insurance/submit-claim` - Voice agent submits claim

2. **Claim Status**:
   - Status: `draft` → `submitted` → `approved` → `paid`
   - Current: Claims can be created but editing is limited

### What's Needed:
**Provider should be able to edit/add fields BEFORE submitting to insurer:**

1. **Editable Fields**:
   - Service codes (CPT codes)
   - Diagnosis codes (ICD-10 codes)
   - Service dates
   - Amounts (billed amount, allowed amount)
   - Provider information
   - Patient information
   - Notes/descriptions

2. **New Endpoint Needed**:
   - `PUT /api/claims/:claimId` - Update claim before submission
   - `PATCH /api/claims/:claimId` - Partial update
   - `GET /api/claims/:claimId/edit` - Get editable claim data

3. **UI Needed**:
   - Provider dashboard: Edit claim button
   - Form to edit all claim fields
   - Validation before submission
   - Preview before sending to insurer

### Current Endpoints:
- ✅ `POST /api/claims/create-from-pdf` - Create claim
- ✅ `GET /api/claims/:id` - Get claim details
- ✅ `POST /api/claims/:claimId/submit-payment` - Submit to insurer
- ❌ **MISSING**: `PUT/PATCH /api/claims/:claimId` - Edit claim

---

## 🤖 Medical Bill Sorting Agent

### Yes, I Agree! We're Building a Medical Bill Sorting Agent

### What This Agent Does:

1. **Receives Medical Bills**:
   - From providers (invoices/claims)
   - From patients (bills they receive)
   - From insurers (EOBs)

2. **Sorts & Categorizes**:
   - **By Patient**: Links bills to correct patient
   - **By Provider**: Identifies which provider sent the bill
   - **By Insurer**: Matches to correct insurance plan
   - **By Service Type**: Categorizes by CPT codes
   - **By Status**: Draft, Submitted, Approved, Paid, Denied

3. **Matches & Reconciles**:
   - Matches claims to appointments
   - Matches EOBs to claims
   - Matches payments to bills
   - Identifies duplicates
   - Flags discrepancies

4. **Routes Appropriately**:
   - **To Patient**: Shows what they owe (copay, deductible, coinsurance)
   - **To Provider**: Shows claim status, payment received
   - **To Insurer**: Submits claims, receives EOBs
   - **To Wallet**: Deducts payments automatically

5. **Automates Workflow**:
   - Auto-submit claims to insurer
   - Auto-process EOBs
   - Auto-calculate patient responsibility
   - Auto-deduct from patient wallet
   - Auto-send notifications

### Current Architecture:
- ✅ **Voice Agent** (Retell): Collects patient info, insurance, schedules appointments
- ✅ **Insurance Service** (STEDI): Checks eligibility, submits claims, gets EOBs
- ✅ **FHIR Service**: Manages patient data, encounters, observations
- ✅ **Payment Orchestrator**: Handles payments, wallet deductions
- ✅ **EOB Calculation**: Calculates patient responsibility from EOBs
- ⚠️ **Missing**: Provider invoice editing before submission

### The Agent Flow:
```
Provider creates invoice → Agent sorts/validates → Provider edits if needed → 
Agent submits to insurer → Insurer processes → Agent receives EOB → 
Agent calculates patient responsibility → Agent deducts from wallet → 
Agent notifies patient & provider
```

---

## 🎯 Action Items

### Immediate:
1. ✅ Update patient name to "Otieno Jeremiah"
2. ✅ Update dashboard to show "Hi OJ" (initials)
3. ⏭️ Verify My Benefits displays correctly
4. ⏭️ Add provider invoice editing endpoint
5. ⏭️ Add provider invoice editing UI

### Next Steps:
1. Create `PUT /api/claims/:claimId` endpoint for editing
2. Add edit form in provider dashboard
3. Add validation before submission
4. Test full flow: Create → Edit → Submit → Process EOB

---

## 📝 Summary

**Patient**: Otieno Jeremiah (shows as "Hi OJ")  
**Benefits**: Should display STEDI insurance data matching patient & provider  
**Invoice Editing**: Provider needs ability to edit claims before submitting to insurer  
**Agent Purpose**: Medical bill sorting agent that automates the entire billing workflow

