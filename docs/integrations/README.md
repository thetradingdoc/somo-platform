# integrations — consolidated documentation

**Single file:** All former `docs/integrations/**/*.md` content is merged here. **Last updated:** 2026-04-20

## Table of contents

- [Integrations Documentation (`README.md`)](#readme)
- [STEDI API Endpoints - Production Connection (`stedi/api/STEDI_API_ENDPOINTS.md`)](#stedi-api-stedi-api-endpoints)
- [Stedi vs UHC FHIR API - Data Comparison & Requirements (`stedi/api/STEDI_VS_UHC_FHIR_DATA_COMPARISON.md`)](#stedi-api-stedi-vs-uhc-fhir-data-comparison)
- [Stripe Issuing — Setup, Status & Implementation (`stripe/issuing/STRIPE_ISSUING.md`)](#stripe-issuing-stripe-issuing)
- [UHC FHIR Service - Usage Guide (`uhc/fhir/UHC_FHIR_SERVICE_USAGE.md`)](#uhc-fhir-uhc-fhir-service-usage)
- [UHC FLEX FHIR API - URL Migration Analysis (`uhc/fhir/UHC_FLEX_FHIR_API_ANALYSIS.md`)](#uhc-fhir-uhc-flex-fhir-api-analysis)
---

## Introduction

Browse by anchor above. Each section notes the former file path.

---

<a id="readme"></a>

## Integrations Documentation

*Former path: `docs/integrations/README.md`*

**Last Updated:** April 9, 2026

This directory contains documentation for third-party integrations and APIs.

## 📁 Files

### [STEDI API Endpoints](./README.md#stedi-api-stedi-api-endpoints)
Complete documentation of STEDI API integration for healthcare insurance operations:

**Endpoints Available:**
1. **Eligibility Check** (X12 270/271) - `POST /x12/translate/270-to-edi`
2. **Claim Submission** (X12 837) - `POST /x12/translate/837-to-edi`
3. **Claim Status** (X12 276/277) - `POST /x12/translate/276-to-edi`
4. **Payer Directory** - `GET /payers` or `GET /v1/payers`

**STEDI Sandbox Data Format:**
- Member IDs: `TEST` + 6 digits (e.g., `TEST999888`)
- Payer IDs: `UHC`, `BCBS`, `AETNA`, `CIGNA`
- Service Codes: CPT codes (e.g., `90834`, `99213`)

**Production Connection:**
- Base URL: `https://api.stedi.com`
- Authentication: Bearer token via `STEDI_API_KEY`
- Environment: `STEDI_API_BASE`, `STEDI_API_KEY`

## 🔗 Related Documentation

- [STEDI vs UHC FHIR Comparison](./README.md#stedi-api-stedi-vs-uhc-fhir-data-comparison)
- [UHC Flex FHIR API Analysis](./README.md#uhc-fhir-uhc-flex-fhir-api-analysis)


---

<a id="stedi-api-stedi-api-endpoints"></a>

## STEDI API Endpoints - Production Connection

*Former path: `docs/integrations/stedi/api/STEDI_API_ENDPOINTS.md`*

## STEDI API Configuration

**Base URL**: `https://api.stedi.com`  
**Authentication**: Bearer token via `STEDI_API_KEY`  
**API key**: Do not hardcode or commit keys in docs. Use a local `.env` (see `middleware-platform/.env.example`).

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



---

<a id="stedi-api-stedi-vs-uhc-fhir-data-comparison"></a>

## Stedi vs UHC FHIR API - Data Comparison & Requirements

*Former path: `docs/integrations/stedi/api/STEDI_VS_UHC_FHIR_DATA_COMPARISON.md`*

## What Stedi Currently Provides

### 1. **Insurance Discovery**
- **What:** Find patient's active insurance coverage using demographics (name, DOB, address)
- **Use Case:** When patients can't provide accurate insurance info
- **Returns:** Active health plans, subscriber info, basic benefits
- **Format:** JSON via Stedi API

### 2. **Eligibility Checks (X12 270/271)**
- **What:** Real-time eligibility verification for specific services
- **Data Returned:**
  - ✅ Eligible/Not Eligible status
  - ✅ Copay amount
  - ✅ Allowed amount
  - ✅ Insurance pays amount
  - ✅ Deductible (total & remaining)
  - ✅ Coinsurance percentage
  - ✅ Basic plan summary
- **Format:** X12 EDI transactions (translated via Stedi)
- **Limitation:** Batch-style, not real-time FHIR

### 3. **Claims Submission (X12 837)**
- **What:** Submit healthcare claims electronically
- **Format:** X12 EDI transactions
- **Returns:** Claim ID, submission status

### 4. **Claim Status (X12 276/277)**
- **What:** Check status of submitted claims
- **Returns:** Status (submitted/processing/approved/paid), payment amount, payment date

### 5. **Payer Directory**
- **What:** List of insurance payers
- **Returns:** Payer IDs, names, supported transactions
- **Limitation:** No provider directory, no network information

---

## What UHC FHIR API Provides (That Stedi Doesn't)

### 1. **Provider Directory & Network Information** ⭐ **CRITICAL GAP**
**Stedi:** ❌ No provider directory
**UHC FHIR:** ✅ Full provider network data

**Data Available:**
- Provider names, NPIs, specialties
- Provider locations (addresses, phone, hours)
- Network affiliations (which providers accept UHC)
- Provider availability/scheduling
- Provider ratings/reviews (if available)
- Distance-based search (find providers near patient)

**FHIR Resources:**
- `Organization` - Provider organizations
- `Practitioner` - Individual providers
- `PractitionerRole` - Provider roles & specialties
- `Location` - Provider locations
- `Endpoint` - Provider contact methods

**Why This Matters:**
- **Your Current Problem:** You asked "where do we get local provider info from though" - Stedi doesn't provide this
- **Solution:** UHC FHIR can tell you which providers accept UHC insurance in a given area
- **Use Case:** "Find a cardiologist near me who accepts my UHC insurance"

---

### 2. **Comprehensive Patient Clinical Data** ⭐ **MAJOR GAP**
**Stedi:** ❌ No patient clinical data
**UHC FHIR:** ✅ Full patient medical history

**Data Available:**
- **Conditions:** Diagnoses, chronic conditions, medical history
- **Medications:** Current prescriptions, medication history
- **Allergies:** Known allergies and reactions
- **Immunizations:** Vaccination records
- **Lab Results:** Test results, lab values
- **Procedures:** Past procedures and surgeries
- **Observations:** Vital signs, measurements
- **Care Plans:** Treatment plans, goals

**FHIR Resources:**
- `Condition` - Diagnoses and conditions
- `MedicationStatement` / `MedicationRequest` - Medications
- `AllergyIntolerance` - Allergies
- `Immunization` - Vaccinations
- `Observation` - Lab results, vitals
- `Procedure` - Procedures performed
- `CarePlan` - Treatment plans

**Why This Matters:**
- **Better Care:** Provider can see patient's full medical history before appointment
- **Safety:** Know allergies/medications to avoid interactions
- **Continuity:** Track patient health over time

---

### 3. **Real-Time Coverage Details** ⭐ **ENHANCEMENT**
**Stedi:** ✅ Basic eligibility (yes/no, copay, deductible)
**UHC FHIR:** ✅ Detailed coverage breakdown

**Additional Data Available:**
- **Coverage Periods:** Active dates, renewal dates
- **Plan Details:** Plan name, type, tier
- **Benefit Categories:** What's covered (preventive, emergency, mental health, etc.)
- **Authorization Requirements:** Prior auth needed? Referrals required?
- **Network Status:** In-network vs out-of-network benefits
- **Cost Sharing:** Detailed breakdown of copays, coinsurance, deductibles per service type
- **Limitations:** Visit limits, annual maximums, lifetime maximums

**FHIR Resources:**
- `Coverage` - Insurance coverage details
- `CoverageEligibilityRequest` / `CoverageEligibilityResponse` - Detailed eligibility

**Why This Matters:**
- **Better Patient Experience:** "Your plan covers 20 mental health visits per year, you've used 3"
- **Transparency:** Show exact benefits before appointment
- **Authorization:** Know if prior auth is needed upfront

---

### 4. **Claims & EOB (Explanation of Benefits) Data** ⭐ **ENHANCEMENT**
**Stedi:** ✅ Can submit claims, check status
**UHC FHIR:** ✅ Detailed claim history & EOBs

**Additional Data Available:**
- **Claim History:** All past claims (not just status)
- **EOB Details:** Line-by-line breakdown of what was billed vs paid
- **Adjudication:** Why claims were approved/denied
- **Payment History:** When payments were made, to whom
- **Appeals:** Appeal status and history

**FHIR Resources:**
- `Claim` - Claim submissions
- `ClaimResponse` - Claim adjudication results
- `ExplanationOfBenefit` - Detailed EOB data

**Why This Matters:**
- **Transparency:** Patients can see all their claims in one place
- **Dispute Resolution:** Understand why claims were denied
- **Financial Planning:** See spending patterns, remaining benefits

---

### 5. **Appointment Scheduling Integration** ⭐ **NEW CAPABILITY**
**Stedi:** ❌ No scheduling
**UHC FHIR:** ✅ Potentially available (depends on UHC implementation)

**Data Available (if supported):**
- Provider availability
- Appointment slots
- Schedule appointments directly
- Appointment history

**FHIR Resources:**
- `Schedule` - Provider schedules
- `Slot` - Available appointment times
- `Appointment` - Scheduled appointments

**Why This Matters:**
- **Seamless Booking:** Book directly through insurance network
- **Real Availability:** See actual available slots

---

### 6. **Prior Authorization Management** ⭐ **NEW CAPABILITY**
**Stedi:** ❌ No prior auth management
**UHC FHIR:** ✅ Prior auth workflow

**Data Available:**
- Submit prior authorization requests
- Check authorization status
- Authorization requirements per service
- Authorization history

**FHIR Resources:**
- `ServiceRequest` - Authorization requests
- `Task` - Authorization workflow status

**Why This Matters:**
- **Prevent Denials:** Get authorization before service
- **Faster Processing:** Electronic prior auth vs phone/fax

Somo’s canonical prior-authorization workflow (including the Stedi scope constraints and the case-level tracking model) is documented in:

- [`docs/RCM/PA_ARCHITECTURE.md`](../RCM/PA_ARCHITECTURE.md)
- [`docs/RCM/STEDI_PA_WORKSTREAM.md`](../RCM/STEDI_PA_WORKSTREAM.md)

---

## What You Need to Access UHC FHIR API

### 1. **OAuth 2.0 Client Credentials** 🔑 **REQUIRED**

**What You Need:**
- **Client ID:** Provided by UHC after registration
- **Client Secret:** Provided by UHC after registration
- **Redirect URI:** Your callback URL (if using authorization code flow)
- **Scopes:** Permissions requested (e.g., `patient/Coverage.read`, `patient/Patient.read`)

**How to Get:**
1. Register your application at: https://flex.optum.com/portal
2. Complete UHC's developer onboarding process
3. Submit application for review (may take days/weeks)
4. Receive credentials after approval

**OAuth Endpoint:**
```
https://flex.optum.com/authz/oauth/token
```

---

### 2. **FHIR Base URL Configuration** 🔗 **REQUIRED**

**Production:**
```
https://flex.optum.com/fhir/R4
OR
https://flex.optum.com/fhir/UHC/R4 (payer-specific)
```

**Sandbox (for testing):**
```
https://flex.optum.com/fhir/sandbox/R4
```

**Public (unauthenticated metadata):**
```
https://flex.optum.com/fhirpublic
```

---

### 3. **Technical Requirements**

#### **FHIR R4 Compatibility**
- Your system must support FHIR R4 standard
- Must handle FHIR JSON format
- Must understand FHIR resource structure

**Good News:** You already have FHIR infrastructure:
- ✅ `fhir-service.js` - FHIR service layer
- ✅ `fhir-adapter.js` - FHIR adapter
- ✅ `routes/fhir.js` - FHIR API routes
- ✅ Database tables for FHIR resources

#### **OAuth 2.0 Implementation**
- Must implement OAuth 2.0 client credentials flow (or authorization code flow)
- Must handle token refresh
- Must securely store tokens

**What You Need to Build:**
```javascript
// OAuth token management
class UHCAuthService {
  async getAccessToken() {
    // POST to https://flex.optum.com/authz/oauth/token
    // with client_id, client_secret, grant_type=client_credentials
    // Store token with expiration
  }
  
  async refreshToken() {
    // Refresh expired tokens
  }
}
```

#### **FHIR Client**
- HTTP client that adds OAuth token to requests
- Handles FHIR Bundle responses
- Handles pagination (FHIR uses `_count`, `_offset`)

**What You Need to Build:**
```javascript
// FHIR API client
class UHCFHIRClient {
  async getCoverage(patientId) {
    // GET https://flex.optum.com/fhir/R4/Coverage?beneficiary=Patient/[id]
    // Headers: Authorization: Bearer [token]
  }
  
  async searchProviders(zipCode, specialty) {
    // GET https://flex.optum.com/fhir/R4/Organization?address-postalcode=[zip]&specialty=[code]
  }
}
```

---

### 4. **Compliance & Security Requirements** 🔒 **REQUIRED**

#### **HIPAA Compliance**
- Must sign Business Associate Agreement (BAA) with UHC
- Must implement proper data encryption (in transit & at rest)
- Must have audit logging for PHI access
- Must have access controls

#### **Security Standards**
- TLS 1.2+ for all API calls
- Secure token storage (encrypted)
- No logging of PHI in plain text
- Proper error handling (don't expose PHI in errors)

#### **Data Handling**
- Must comply with patient consent requirements
- Must handle data retention policies
- Must support patient data deletion requests

---

### 5. **Registration & Approval Process** 📋 **REQUIRED**

**Steps:**
1. **Register Application:**
   - Go to https://flex.optum.com/portal
   - Create developer account
   - Submit application details:
     - Organization name
     - Use case description
     - Technical architecture
     - Security measures
     - Data handling procedures

2. **Review Process:**
   - UHC reviews application (typically 2-4 weeks)
   - May request additional documentation
   - May require security audit

3. **Sandbox Access:**
   - Get sandbox credentials first
   - Test integration in sandbox
   - Verify all endpoints work

4. **Production Approval:**
   - Submit production access request
   - Complete production testing
   - Go live

---

### 6. **Cost Considerations** 💰

**Stedi:**
- Pay-per-API-call pricing
- Typically $0.10-$1.00 per eligibility check
- $0.50-$2.00 per claim submission

**UHC FHIR:**
- **Likely Free** (if approved as partner)
- May have usage limits/quotas
- May require minimum volume commitments
- Check UHC's pricing documentation

---

## Summary: What Data UHC FHIR Adds

### **Critical Gaps Filled:**

1. **Provider Directory** ⭐⭐⭐
   - **Your Need:** "where do we get local provider info from though"
   - **UHC Provides:** Full provider network with locations, specialties, network status
   - **Impact:** Can answer "find providers near me who accept my insurance"

2. **Patient Clinical History** ⭐⭐⭐
   - **Your Need:** Better patient care, safety (allergies/meds)
   - **UHC Provides:** Full medical history, medications, allergies, conditions
   - **Impact:** Providers see full context before appointments

3. **Detailed Coverage** ⭐⭐
   - **Your Need:** Better patient experience, transparency
   - **UHC Provides:** Detailed benefits, limitations, authorization requirements
   - **Impact:** Show exact benefits, prevent surprises

4. **Claims History & EOBs** ⭐⭐
   - **Your Need:** Patient transparency, financial planning
   - **UHC Provides:** All past claims, detailed EOBs, payment history
   - **Impact:** Patients see full claims history

5. **Prior Authorization** ⭐
   - **Your Need:** Prevent claim denials
   - **UHC Provides:** Electronic prior auth workflow
   - **Impact:** Faster authorizations, fewer denials

---

## What You Need to Do

### **To Access UHC FHIR API:**

1. **Register:** https://flex.optum.com/portal
2. **Get Credentials:** Client ID, Client Secret
3. **Implement OAuth:** Token management service
4. **Build FHIR Client:** HTTP client with OAuth
5. **Test in Sandbox:** Verify all endpoints
6. **Get Production Access:** Complete approval process
7. **Integrate:** Add UHC FHIR service to your platform

### **Estimated Timeline:**
- Registration: 1-2 days
- Review/Approval: 2-4 weeks
- Development: 1-2 weeks (if you have FHIR infrastructure - which you do!)
- Testing: 1 week
- **Total: 4-7 weeks**

---

## Recommendation

**For Provider Directory (Your Main Need):**
- **UHC FHIR is the solution** - Stedi doesn't provide this
- **Priority:** High - This directly solves "where do we get local provider info"

**For Other Data:**
- **Clinical History:** Nice to have, but not critical for appointment booking
- **Detailed Coverage:** Enhancement, but Stedi eligibility is sufficient for now
- **Claims History:** Nice to have for patient portal

**Suggested Approach:**
1. **Start with Provider Directory** - Register for UHC FHIR, get provider network data
2. **Keep Stedi for Eligibility** - It works, it's simpler, it's already integrated
3. **Add Clinical Data Later** - If you need it for better care coordination












---

<a id="stripe-issuing-stripe-issuing"></a>

## Stripe Issuing — Setup, Status & Implementation

*Former path: `docs/integrations/stripe/issuing/STRIPE_ISSUING.md`*

**Last Updated:** April 6, 2026

Consolidated from: STRIPE_ISSUING_COMPLETE_GUIDE, STRIPE_ISSUING_STATUS, STRIPE_ISSUING_ON_DEMAND, STRIPE_ISSUING_IMPLEMENTATION, STRIPE_ISSUING_INTEGRATION.

---

## 1. Status

✅ **Fully Implemented** — Stripe Issuing integration is complete.

⚠️ **Requires Configuration** — Needs `STRIPE_SECRET_KEY`. Without it, runs in mock mode.

### Card Creation Modes

| Mode | When | Location | Note |
|------|------|----------|------|
| **Auto (legacy)** | At patient creation via FHIR | fhir-service.js `createPatientCard()` | Can be disabled |
| **On-demand** | When insured patient has bills/copays | insurance-service.js, voice/appointments/checkout | Cards only for insured patients with patient responsibility |
| **Manual** | `POST /api/patient/:patientId/cards` | server.js | Admin or patient request |

**Current default:** On-demand only for insured patients (see [On-Demand section](#4-on-demand-card-creation)).

---

## 2. Quick Setup

### Environment Variables
```bash
STRIPE_SECRET_KEY=sk_test_...    # Required
STRIPE_PUBLISHABLE_KEY=pk_test_...  # Optional (frontend)
STRIPE_ISSUING_WEBHOOK_SECRET=whsec_...  # For webhooks
```

### Enable Issuing
1. [Stripe Dashboard → Issuing](https://dashboard.stripe.com/test/issuing) → Enable
2. Fund Issuing Balance (test mode: use `4242 4242 4242 4242`)

### Webhook
- **Endpoint:** `POST /webhooks/stripe/issuing`
- **Events:** `issuing_authorization.created`, `issuing_transaction.created`, `issuing_card.created`, `issuing_card.updated`

---

## 3. How It Works

### Flow
```
Patient/Bill/Copay → FHIR/Insurance → StripeIssuingService → Stripe API → stripe_cardholders, stripe_cards, stripe_card_transactions
```

### Database Tables
- **stripe_cardholders** — patient_id, stripe_cardholder_id, name, email, phone, billing_address
- **stripe_cards** — cardholder_id, stripe_card_id, last4, brand, spending_controls
- **stripe_card_transactions** — card_id, amount, merchant_name, status

### API Endpoints
- `GET /api/patient/:patientId/cards`
- `POST /api/patient/:patientId/cards`
- `GET /api/patient/cards/:cardId` (PAN/CVC for virtual)
- `PATCH /api/patient/cards/:cardId/spending-controls`
- `POST /api/patient/cards/:cardId/cancel`
- `GET /api/patient/cards/:cardId/transactions`

### Key Service Methods (stripe-issuing-service.js)
- `createCardholder()`, `createCard()`, `createCardholderAndCard()`
- `getCardDetails()`, `updateCardSpendingControls()`, `cancelCard()`

---

## 4. On-Demand Card Creation

Cards are **on-demand** for **insured patients** when:
- Insurance claim submitted with patient responsibility
- Appointment checkout with copay
- Manual API request (`POST /api/patient/:patientId/cards`)

**Insurance check:** Cards only created when `patientHasInsurance(patientId)`.

**Bill/copay limits:** Card limit = bill/copay amount + 10% buffer.

---

## 5. Troubleshooting

| Issue | Fix |
|-------|-----|
| "Stripe Issuing not configured" | Set `STRIPE_SECRET_KEY` in .env |
| "Issuing not enabled" | Enable in Stripe Dashboard → Issuing |
| "Insufficient funds" | Add funds to Issuing Balance |
| Webhook not receiving events | Verify URL, `STRIPE_ISSUING_WEBHOOK_SECRET` |

---

## 6. Related

- [Payment Architecture](../../architecture/README.md#payments-payment-architecture)
- [API Documentation](../../api/README.md#api-documentation)


---

<a id="uhc-fhir-uhc-fhir-service-usage"></a>

## UHC FHIR Service - Usage Guide

*Former path: `docs/integrations/uhc/fhir/UHC_FHIR_SERVICE_USAGE.md`*

## Overview

The UHC FHIR Service (`uhc-fhir-service.js`) attempts to pull all available data from UHC FLEX FHIR API, including:
- Provider Directory (Organizations, Practitioners, Locations)
- Patient Clinical Data (Conditions, Medications, Allergies, etc.)
- Coverage Information
- Claims & EOBs
- Prior Authorization Data

## Setup

### 1. Get UHC OAuth Credentials

1. Register at: https://flex.optum.com/portal
2. Complete developer onboarding
3. Get `CLIENT_ID` and `CLIENT_SECRET`

### 2. Configure Environment Variables

```bash
# Required for authenticated endpoints
export UHC_CLIENT_ID="your-client-id"
export UHC_CLIENT_SECRET="your-client-secret"

# Optional - defaults provided
export UHC_OAUTH_URL="https://flex.optum.com/authz"
export UHC_FHIR_BASE="https://flex.optum.com/fhir/R4"
export UHC_FHIR_SANDBOX="https://flex.optum.com/fhir/sandbox/R4"
export UHC_FHIR_PUBLIC="https://flex.optum.com/fhirpublic"
```

Or add to `.env` file:
```env
UHC_CLIENT_ID=your-client-id
UHC_CLIENT_SECRET=your-client-secret
```

## Usage

### Option 1: Test Script (Recommended for Testing)

Run the comprehensive test script:

```bash
cd middleware-platform
node tests/test-uhc-fhir.js
```

This will:
- Test connection (public metadata endpoint)
- Pull provider directory
- Pull patient clinical data
- Pull coverage data
- Pull claims data
- Pull prior auth data
- Pull ALL data (comprehensive)

### Option 2: API Endpoints

Start your server and use these endpoints:

#### Test Connection (No Auth Required)
```bash
curl http://localhost:3000/api/test/uhc-fhir/connection?sandbox=true
```

#### Pull Provider Directory
```bash
# Search providers by zip code
curl "http://localhost:3000/api/test/uhc-fhir/providers?zip=10001&limit=10&sandbox=true"

# Search by specialty
curl "http://localhost:3000/api/test/uhc-fhir/providers?specialty=cardiology&sandbox=true"
```

#### Pull Patient Clinical Data
```bash
curl "http://localhost:3000/api/test/uhc-fhir/patient/test-patient-001/clinical?sandbox=true"
```

#### Pull Coverage Data
```bash
curl "http://localhost:3000/api/test/uhc-fhir/patient/test-patient-001/coverage?sandbox=true"
```

#### Pull Claims Data
```bash
curl "http://localhost:3000/api/test/uhc-fhir/patient/test-patient-001/claims?sandbox=true"
```

#### Pull ALL Data (Comprehensive)
```bash
curl "http://localhost:3000/api/test/uhc-fhir/patient/test-patient-001/all?sandbox=true"
```

### Option 3: Programmatic Usage

```javascript
const UHCFHIRService = require('./services/uhc-fhir-service');

// Test connection
const connectionTest = await UHCFHIRService.testConnection(true);

// Pull provider directory
const providers = await UHCFHIRService.pullProviderDirectory({
  useSandbox: true,
  zipCode: '10001',
  specialty: 'cardiology',
  limit: 50
});

// Pull patient clinical data
const clinicalData = await UHCFHIRService.pullPatientClinicalData('patient-id', {
  useSandbox: true
});

// Pull coverage
const coverage = await UHCFHIRService.pullCoverageData('patient-id', {
  useSandbox: true
});

// Pull claims
const claims = await UHCFHIRService.pullClaimsData('patient-id', {
  useSandbox: true
});

// Pull prior auth
const priorAuth = await UHCFHIRService.pullPriorAuthData('patient-id', {
  useSandbox: true
});

// Pull ALL data
const allData = await UHCFHIRService.pullAllPatientData('patient-id', {
  useSandbox: true
});
```

## Data Types Pulled

### 1. Provider Directory

**Resources:**
- `Organization` - Provider organizations
- `Practitioner` - Individual providers
- `Location` - Provider locations
- `PractitionerRole` - Provider-specialty relationships

**Example Response:**
```json
{
  "success": true,
  "data": {
    "organizations": [...],
    "practitioners": [...],
    "locations": [...],
    "practitionerRoles": [...]
  },
  "totalProviders": 45,
  "errors": []
}
```

### 2. Patient Clinical Data

**Resources:**
- `Condition` - Diagnoses and conditions
- `MedicationStatement` - Current medications
- `AllergyIntolerance` - Allergies
- `Immunization` - Vaccinations
- `Observation` - Lab results, vitals
- `Procedure` - Procedures performed
- `CarePlan` - Treatment plans

**Example Response:**
```json
{
  "success": true,
  "data": {
    "conditions": [...],
    "medications": [...],
    "allergies": [...],
    "immunizations": [...],
    "observations": [...],
    "procedures": [...],
    "carePlans": [...]
  },
  "errors": []
}
```

### 3. Coverage Data

**Resources:**
- `Coverage` - Insurance coverage details
- `CoverageEligibilityResponse` - Eligibility responses

**Example Response:**
```json
{
  "success": true,
  "data": {
    "coverage": [...],
    "eligibilityResponses": [...]
  },
  "errors": []
}
```

### 4. Claims & EOBs

**Resources:**
- `Claim` - Submitted claims
- `ClaimResponse` - Claim adjudication
- `ExplanationOfBenefit` - Detailed EOBs

**Example Response:**
```json
{
  "success": true,
  "data": {
    "claims": [...],
    "claimResponses": [...],
    "eobs": [...]
  },
  "errors": []
}
```

### 5. Prior Authorization

**Resources:**
- `ServiceRequest` - Prior auth requests
- `Task` - Prior auth workflow status

**Example Response:**
```json
{
  "success": true,
  "data": {
    "serviceRequests": [...],
    "tasks": [...]
  },
  "errors": []
}
```

## Error Handling

The service gracefully handles errors:

- **Missing Credentials:** Will attempt public endpoints, but authenticated endpoints will fail
- **OAuth Failures:** Will log error and return unauthenticated client
- **API Failures:** Each data type pull is independent - if one fails, others continue
- **Invalid Patient IDs:** Will return empty results with error messages

**Example Error Response:**
```json
{
  "success": false,
  "data": null,
  "error": "UHC OAuth credentials not configured"
}
```

## Authentication Flow

1. **First Call:** Service requests OAuth token using client credentials
2. **Token Caching:** Token is cached with expiration time
3. **Auto-Refresh:** Token is automatically refreshed if expires in < 5 minutes
4. **All Requests:** Token is added to `Authorization: Bearer [token]` header

## Sandbox vs Production

- **Sandbox:** Use for testing (default in test script)
  - URL: `https://flex.optum.com/fhir/sandbox/R4`
  - May have limited/test data
  - Safer for development

- **Production:** Use for real data
  - URL: `https://flex.optum.com/fhir/R4`
  - Real patient data (requires proper authorization)
  - Requires production credentials

## Troubleshooting

### "UHC OAuth credentials not configured"
- Set `UHC_CLIENT_ID` and `UHC_CLIENT_SECRET` environment variables
- Or register at https://flex.optum.com/portal

### "Connection failed" or "401 Unauthorized"
- Check credentials are correct
- Verify OAuth token endpoint is accessible
- Check if credentials are approved for sandbox/production

### "404 Not Found" on patient endpoints
- Patient ID may not exist in sandbox
- Try different patient ID
- Check if endpoint requires different format

### "No data returned"
- Sandbox may not have test data for that resource type
- Some endpoints may require specific scopes
- Check UHC documentation for available resources

## Next Steps

1. **Get Credentials:** Register at https://flex.optum.com/portal
2. **Test Connection:** Run `node tests/test-uhc-fhir.js`
3. **Test Provider Directory:** This is the main gap Stedi doesn't fill
4. **Integrate:** Use provider directory data in your provider search feature

## Integration Example

```javascript
// In your provider directory service
const UHCFHIRService = require('./services/uhc-fhir-service');

async function findProvidersByInsurance(payerId, zipCode) {
  // Pull UHC provider directory
  const result = await UHCFHIRService.pullProviderDirectory({
    useSandbox: false, // production
    zipCode: zipCode,
    limit: 100
  });
  
  if (result.success && result.data) {
    // Filter by payer/insurance network
    // Map FHIR resources to your provider format
    // Return to caller
    return result.data.organizations.map(org => ({
      name: org.name,
      npi: org.identifier?.find(id => id.system.includes('npi'))?.value,
      address: org.address?.[0],
      // ... map other fields
    }));
  }
  
  return [];
}
```






---

<a id="uhc-fhir-uhc-flex-fhir-api-analysis"></a>

## UHC FLEX FHIR API - URL Migration Analysis

*Former path: `docs/integrations/uhc/fhir/UHC_FLEX_FHIR_API_ANALYSIS.md`*

## Overview
UnitedHealthcare (UHC) is migrating from subdomain-based routing to path-based routing for their FLEX FHIR API endpoints. **Old URLs will be decommissioned at the end of November**, requiring all integrations to migrate to the new URL structure.

## URL Changes Summary

### 1. Public FHIR API Calls
**Old:**
```
https://public.flex.optum.com
```

**New (Two Options):**
```
https://flex.optum.com/fhirpublic
https://flex.optum.com/fhirpublic2025
```

**Analysis:**
- Two new endpoints suggest versioning strategy
- `fhirpublic2025` likely indicates a newer API version or future-proofing
- Path-based routing (`/fhirpublic`) instead of subdomain (`public.flex.optum.com`)

### 2. Sandbox FHIR API Calls
**Old:**
```
https://sandbox.fhir.flex.optum.com/R4/metadata
```

**New:**
```
https://flex.optum.com/fhir/sandbox/R4/metadata
```

**Analysis:**
- Consolidated under main domain with `/fhir/sandbox/` path
- Maintains R4 FHIR version in path
- Metadata endpoint structure preserved

### 3. OAuth Authentication
**Old:**
```
https://authz.flex.optum.com
```

**New:**
```
https://flex.optum.com/authz
```

**Analysis:**
- Simplified path-based routing
- Critical for authentication - must update before other endpoints work
- OAuth token endpoints likely at `/authz/token`, `/authz/authorize`, etc.

### 4. Production FHIR API Calls
**Old:**
```
https://fhir.flex.optum.com/R4
```

**New (Two Options):**
```
https://flex.optum.com/fhir/R4
https://flex.optum.com/fhir/[payer]/R4
```

**Analysis:**
- Generic endpoint: `/fhir/R4` (likely for multi-payer or default)
- Payer-specific endpoint: `/fhir/[payer]/R4` (payer-specific routing)
- `[payer]` parameter suggests payer-specific API instances or routing

### 5. Portal Access
**New:**
```
https://flex.optum.com/portal
```

**Analysis:**
- New portal endpoint for web-based access
- Likely for administrative/management functions

## API Access Patterns & Implications

### 1. **Authentication Flow**
```
OLD: https://authz.flex.optum.com/oauth/token
NEW: https://flex.optum.com/authz/oauth/token
```
- **Impact:** All OAuth flows must be updated
- **Action Required:** Update OAuth client configuration
- **Timeline:** Must complete before other API calls work

### 2. **FHIR Resource Access**
```
OLD: https://fhir.flex.optum.com/R4/Patient/12345
NEW: https://flex.optum.com/fhir/R4/Patient/12345
     OR
     https://flex.optum.com/fhir/UHC/R4/Patient/12345 (payer-specific)
```

**Key Questions:**
- When to use generic `/fhir/R4` vs payer-specific `/fhir/[payer]/R4`?
- What payer identifiers are valid for `[payer]` parameter?
- Are there different capabilities/endpoints per payer?

### 3. **Public vs Authenticated Endpoints**
- **Public endpoints** (`/fhirpublic`) - Likely for:
  - Public metadata
  - Unauthenticated resource discovery
  - Public capability statements
  
- **Authenticated endpoints** (`/fhir/R4`) - For:
  - Patient data access
  - Eligibility checks
  - Claims submission
  - Requires OAuth token

### 4. **Sandbox Environment**
- Sandbox now clearly separated: `/fhir/sandbox/R4/`
- Useful for testing before production migration
- May have different authentication requirements

## Integration Requirements

### Current State (Your Platform)
Your platform currently uses:
- **Stedi API** for insurance operations (X12 EDI transactions)
- **Local payer cache** for payer lookups
- **No direct UHC FHIR integration** currently

### Potential Integration Points

#### 1. **Eligibility Checks**
**Current:** Stedi X12 270/271 transactions
**Potential:** UHC FHIR Coverage/CoverageEligibilityRequest resources
```
POST https://flex.optum.com/fhir/R4/CoverageEligibilityRequest
```

#### 2. **Provider Directory**
**Current:** Local database + manual entry
**Potential:** UHC FHIR Organization/Endpoint resources
```
GET https://flex.optum.com/fhir/R4/Organization?insurance=UHC
```

#### 3. **Claims Submission**
**Current:** Stedi X12 837 transactions
**Potential:** UHC FHIR Claim resources
```
POST https://flex.optum.com/fhir/R4/Claim
```

#### 4. **Patient Data**
**Current:** Local FHIR Patient resources
**Potential:** Sync with UHC FHIR Patient resources
```
GET https://flex.optum.com/fhir/R4/Patient/[id]
```

## Migration Checklist

### Immediate Actions (Before End of November)
- [ ] Review UHC developer documentation: https://www.uhc.com/legal/interoperability-apis
- [ ] Identify all current integrations using old URLs (if any)
- [ ] Test new endpoints in sandbox environment
- [ ] Update OAuth configuration to new `/authz` endpoint
- [ ] Update all API base URLs in configuration
- [ ] Test authentication flow with new endpoints
- [ ] Verify FHIR resource access with new URLs
- [ ] Update error handling for new endpoint responses

### Code Changes Required (If Integrating)
1. **Environment Variables:**
   ```env
   # OLD (if used)
   UHC_OAUTH_URL=https://authz.flex.optum.com
   UHC_FHIR_BASE=https://fhir.flex.optum.com/R4
   
   # NEW
   UHC_OAUTH_URL=https://flex.optum.com/authz
   UHC_FHIR_BASE=https://flex.optum.com/fhir/R4
   UHC_FHIR_PUBLIC=https://flex.optum.com/fhirpublic
   UHC_FHIR_SANDBOX=https://flex.optum.com/fhir/sandbox/R4
   ```

2. **API Client Updates:**
   - Update base URLs in HTTP clients
   - Update OAuth token endpoint
   - Add payer-specific routing logic (if using `/fhir/[payer]/R4`)

3. **Error Handling:**
   - Handle potential redirects from old URLs
   - Update error messages for new endpoint failures
   - Add fallback logic during transition period

## Key Questions to Resolve

1. **Payer-Specific Routing:**
   - What payer identifiers are valid for `/fhir/[payer]/R4`?
   - When should you use payer-specific vs generic endpoint?
   - Are there different capabilities per payer?

2. **API Versioning:**
   - What's the difference between `/fhirpublic` and `/fhirpublic2025`?
   - Should you use both or migrate to 2025 version?
   - Are there breaking changes in 2025 version?

3. **Authentication:**
   - Does OAuth flow change with new endpoints?
   - Are scopes/permissions different?
   - Is client credential flow supported?

4. **Rate Limits & Quotas:**
   - Do rate limits change with new endpoints?
   - Are there different quotas for public vs authenticated?
   - How are payer-specific endpoints rate-limited?

5. **Backward Compatibility:**
   - Will old URLs redirect to new ones?
   - Is there a grace period after November?
   - What happens to existing tokens/credentials?

## Recommendations

### If You're NOT Currently Using UHC FLEX API:
- **No immediate action required** - Your Stedi integration is unaffected
- **Future consideration:** Evaluate UHC FHIR API for direct integration benefits:
  - Real-time eligibility (vs X12 batch processing)
  - Direct provider directory access
  - Native FHIR resource support

### If You ARE Using UHC FLEX API:
1. **Immediate:** Test sandbox endpoints to understand new structure
2. **Before November:** Complete migration to new URLs
3. **Documentation:** Review full API docs at https://www.uhc.com/legal/interoperability-apis
4. **Testing:** Use sandbox environment extensively before production switch
5. **Monitoring:** Set up alerts for old URL failures after migration

## Next Steps

1. **Review Official Documentation:**
   - Visit: https://www.uhc.com/legal/interoperability-apis
   - Download API specifications
   - Review authentication requirements

2. **Sandbox Testing:**
   - Register for sandbox access (if not already)
   - Test OAuth flow with new `/authz` endpoint
   - Test FHIR resource access with new URLs
   - Verify payer-specific routing (if applicable)

3. **Production Migration:**
   - Schedule migration window before November deadline
   - Update configuration in staging first
   - Monitor for errors during transition
   - Have rollback plan ready

## References
- UHC Developer Documentation: https://www.uhc.com/legal/interoperability-apis
- Portal: https://flex.optum.com/portal
- Migration Deadline: End of November (exact date TBD)












