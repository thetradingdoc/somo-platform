# STEDI API Endpoints - Production Connection

## STEDI API Configuration

**Base URL**: `https://api.stedi.com`  
**Authentication**: Bearer token via `STEDI_API_KEY`  
**Current API Key**: `test_1rRzTb0.Va9Tn88BB3fgPgttprqbrxQ1` (Sandbox/Test)

---

## Available STEDI API Endpoints

### 1. **Eligibility Check (X12 270/271)**
**Endpoint**: `POST /x12/translate/270-to-edi`  
**Purpose**: Check patient insurance eligibility for specific services  
**Request Format**:
```json
{
  "transactionType": "270",
  "patient": {
    "name": "Jeremiah Richie",
    "dateOfBirth": "1985-06-15",
    "memberId": "TEST999888"
  },
  "payer": {
    "payerId": "UHC"
  },
  "service": {
    "serviceCode": "90834",
    "dateOfService": "2025-11-21"
  }
}
```

**Response Data** (from STEDI Sandbox):
```json
{
  "eligible": true,
  "copay": 30,
  "allowedAmount": 150,
  "insurancePays": 120,
  "deductibleTotal": 750,
  "deductibleRemaining": 300,
  "coinsurancePercent": 20,
  "planSummary": "Outpatient behavioral health in-network covered; 30$ copay; 20% coinsurance after deductible for some services.",
  "message": "Eligible - Copay $30"
}
```

---

### 2. **Claim Submission (X12 837)**
**Endpoint**: `POST /x12/translate/837-to-edi`  
**Purpose**: Submit healthcare claims electronically  
**Request Format**:
```json
{
  "transactionType": "837",
  "appointmentId": "appt-xxx",
  "patientId": "patient-xxx",
  "memberId": "TEST999888",
  "payerId": "UHC",
  "serviceCode": "90834",
  "diagnosisCode": "F41.1",
  "totalAmount": 150.00,
  "copayPaid": 30.00,
  "dateOfService": "2025-11-21"
}
```

**Response**: Claim ID, submission status

---

### 3. **Claim Status Check (X12 276/277)**
**Endpoint**: `POST /x12/translate/276-to-edi`  
**Purpose**: Check status of submitted claims  
**Returns**: Status (submitted/processing/approved/paid), payment amount, payment date

---

### 4. **Payer Directory**
**Endpoint**: `GET /payers` or `GET /payers/search`  
**Alternative**: `GET /v1/payers`  
**Purpose**: List of insurance payers  
**Query Parameters**:
- `search` - Search payer by name
- `limit` - Limit results

**Returns**: Payer IDs, names, supported transactions

---

## STEDI Sandbox Test Data Structure

Based on actual STEDI Sandbox responses:

### Patient Data Format:
```json
{
  "patient_name": "Jeremiah Richie",
  "patient_phone": "+15551234567",
  "patient_email": "jeremiah.richie@example.com",
  "date_of_birth": "1985-06-15",
  "gender": "male"
}
```

### Insurance Data Format (STEDI):
```json
{
  "member_id": "TEST999888",  // Format: TEST + 6 digits
  "payer_id": "UHC",          // Options: UHC, BCBS, AETNA, CIGNA
  "payer_name": "UnitedHealthcare",
  "service_code": "90834",    // CPT code
  "date_of_service": "2025-11-21"
}
```

### Eligibility Response (STEDI):
```json
{
  "eligible": true,
  "copay": 30,
  "allowedAmount": 150,
  "insurancePays": 120,
  "deductibleTotal": 750,
  "deductibleRemaining": 300,
  "coinsurancePercent": 20,
  "planSummary": "Outpatient behavioral health in-network covered; 30$ copay; 20% coinsurance after deductible for some services.",
  "message": "Eligible - Copay $30"
}
```

---

## Production Connection Details

### Environment Variables:
```bash
STEDI_API_BASE=https://api.stedi.com
STEDI_API_KEY=your_production_api_key_here
```

### Endpoints Available in Production:
1. ✅ **Eligibility Check** - `POST /x12/translate/270-to-edi`
2. ✅ **Claim Submission** - `POST /x12/translate/837-to-edi`
3. ✅ **Claim Status** - `POST /x12/translate/276-to-edi`
4. ✅ **Payer Directory** - `GET /payers` or `GET /v1/payers`

---

## Data We Pull from STEDI in Production

### For Each Patient:
1. **Eligibility Check**:
   - Member ID
   - Payer ID
   - Eligible status
   - Copay amount
   - Allowed amount
   - Insurance pays amount
   - Deductible (total & remaining)
   - Coinsurance percentage
   - Plan summary

2. **Claims**:
   - Claim submission status
   - Claim ID
   - Payment status
   - Payment amount
   - Payment date

3. **Payer Information**:
   - Payer ID
   - Payer name
   - Supported transactions

---

## Test Patient Data (STEDI Sandbox Format)

**Member IDs**: Format `TEST` + 6 digits
- Example: `TEST312181`, `TEST100521`, `TEST999888`

**Payer IDs**: 
- `UHC` - UnitedHealthcare
- `BCBS` - Blue Cross Blue Shield
- `AETNA` - Aetna
- `CIGNA` - Cigna

**Service Codes (CPT)**:
- `90834` - Psychotherapy, 45 minutes
- `99213` - Office visit, established patient
- `99214` - Office visit, detailed

**Typical Coverage**:
- Copay: $30
- Allowed Amount: $150
- Insurance Pays: $120
- Patient Responsibility: $30
- Deductible Total: $750
- Deductible Remaining: $300
- Coinsurance: 20%

