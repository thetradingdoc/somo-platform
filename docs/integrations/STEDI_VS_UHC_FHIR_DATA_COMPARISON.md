# Stedi vs UHC FHIR API - Data Comparison & Requirements

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







