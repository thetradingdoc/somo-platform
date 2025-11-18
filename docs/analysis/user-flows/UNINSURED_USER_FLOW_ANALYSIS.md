# Uninsured User Flow - Feasibility Analysis

## 🎯 Your Vision (What You Want to Build)

**Flow:**
1. User calls in (inbound call) - **NO INSURANCE**
2. Voice agent collects basic info (name, phone, medical history)
3. Send secure link to upload medical records
4. Use Stedi to find best insurance providers for their needs
5. Match and sign them up for insurance (monthly premium)
6. Link to wallet - they can see:
   - List of services
   - Where to deposit monthly premium
   - Insurance info
7. Voice agent handles everything

**Target:** People without insurance (like you mentioned)

---

## ✅ What You HAVE (Current Infrastructure)

### 1. **Voice Agent (Retell)** ✅
- Inbound call handling
- Voice conversation
- Function calling (all 10 functions working)
- Can collect patient info via voice

### 2. **Wallet System (Circle)** ✅
- Patient wallets exist
- Can deposit funds
- Can see balance
- Stripe cards ($3 cards) - mentioned

### 3. **Medical Records (FHIR)** ✅
- FHIR patient records
- Can store medical history
- Document storage structure exists

### 4. **Stedi Integration** ✅
- Eligibility checks (270/271)
- Claims submission (837)
- Insurance discovery (find active insurance)
- Payer directory

### 5. **Payment System** ✅
- Stripe integration
- Recurring payments possible
- Payment links/tokens

---

## ⚠️ CRITICAL GAPS & REALITY CHECK

### 1. **Stedi CANNOT Find Insurance for Uninsured Users** ❌

**Reality:**
- Stedi is for **eligibility/claims** (people who ALREADY have insurance)
- Stedi can **discover** existing insurance if patient doesn't know their info
- Stedi **CANNOT** quote new insurance plans or sign people up

**What You Actually Need:**
- **Healthcare.gov API** (federal marketplace) - for ACA plans
- **State marketplace APIs** (varies by state)
- **Direct carrier partnerships** (Blue Cross, Aetna, etc.)
- **Insurance broker APIs** (e.g., HealthSherpa, Stride Health)

### 2. **Insurance Signup Requires Licensing** ⚠️

**Reality:**
- Selling insurance requires **state insurance licenses**
- Each state has different requirements
- You'd need licensed agents OR partner with licensed brokers
- **Healthcare.gov** allows enrollment but requires proper registration

**Options:**
1. **Partner with licensed broker** (HealthSherpa, Stride Health APIs)
2. **Become licensed** (expensive, time-consuming)
3. **Referral model** - collect info, refer to licensed partner
4. **Use Healthcare.gov** - direct users there (can't sign up for them)

### 3. **Medical Record Upload** ⚠️

**Current State:**
- FHIR structure exists
- No document upload endpoint visible
- Need secure file storage (S3, Azure Blob, etc.)
- Need document parsing (PDF, images)

**What's Needed:**
- Secure upload endpoint
- File storage
- OCR/document parsing
- Link medical records to FHIR patient

---

## 💡 REVISED FLOW (What Actually Makes Sense)

### **Option A: Referral/Assistance Model** (Easiest, Legal)

1. **User calls** → No insurance
2. **Voice agent collects:**
   - Name, phone, email
   - Basic medical history (voice)
   - Medications (voice)
   - Income estimate (for subsidy eligibility)
   - Zip code (for state marketplace)

3. **Create patient record** (FHIR)
4. **Send secure link** → Upload medical records (optional)
5. **Use Healthcare.gov API or broker API** to:
   - Get available plans in their area
   - Show plan options (premium, deductible, coverage)
   - **NOT sign them up** (they do it themselves)

6. **Wallet integration:**
   - Show recommended plans
   - Show estimated monthly premium
   - Link to signup page
   - Track when they enroll

7. **After enrollment:**
   - They provide member ID
   - You verify via Stedi
   - Set up recurring premium payment in wallet

**Pros:**
- ✅ Legal (no licensing needed)
- ✅ Uses existing infrastructure
- ✅ Can still help them find best plan
- ✅ Wallet can manage premium payments

**Cons:**
- ❌ Can't sign them up directly
- ❌ They have to complete enrollment elsewhere

---

### **Option B: Full Brokerage Model** (Complex, Requires Licensing)

1. Same as Option A, but...
2. Partner with licensed broker API (HealthSherpa, Stride)
3. Complete enrollment through partner
4. You get commission
5. Wallet manages premium

**Pros:**
- ✅ Can complete enrollment
- ✅ Revenue opportunity

**Cons:**
- ❌ Requires broker partnership
- ❌ More complex integration
- ❌ Compliance requirements

---

### **Option C: Premium Management Only** (Simplest)

1. User calls → No insurance
2. Help them find insurance (referral to Healthcare.gov)
3. **After they enroll elsewhere:**
   - They provide member ID
   - You verify via Stedi
   - **Wallet manages premium payments** (recurring)
   - Show services they can use
   - Track claims/benefits

**Pros:**
- ✅ Simplest
- ✅ No licensing needed
- ✅ Still valuable (premium management)
- ✅ Uses Stedi for verification

**Cons:**
- ❌ Less control over enrollment
- ❌ They enroll elsewhere

---

## 🎯 RECOMMENDED APPROACH

### **Phase 1: Medical History Collection + Referral** (MVP)

1. ✅ Voice agent collects medical history
2. ✅ Store in FHIR
3. ✅ Send secure upload link for medical records
4. ✅ Use Healthcare.gov API to show plan options
5. ✅ Refer to Healthcare.gov for enrollment
6. ✅ Wallet shows plan info and estimated premium

**What You Need to Build:**
- Medical history collection function (voice)
- Document upload endpoint
- Healthcare.gov API integration (or broker API)
- Plan comparison display in wallet

### **Phase 2: Premium Management** (After Enrollment)

1. ✅ User provides member ID after enrollment
2. ✅ Verify via Stedi eligibility check
3. ✅ Set up recurring premium payment in wallet
4. ✅ Show services/benefits
5. ✅ Track claims

**What You Need:**
- Member ID collection
- Stedi verification
- Recurring payment setup
- Benefits display

### **Phase 3: Broker Partnership** (If You Want Full Enrollment)

1. Partner with HealthSherpa or Stride Health
2. Complete enrollment through API
3. Get commission
4. Full wallet integration

---

## 🔍 KEY QUESTIONS TO ANSWER

1. **Do you want to be a licensed insurance broker?**
   - If YES → Long process, expensive
   - If NO → Use referral/partner model

2. **What's your revenue model?**
   - Commission from broker?
   - Premium management fee?
   - Subscription?

3. **Which states?**
   - Healthcare.gov (federal) vs state marketplaces
   - Different APIs per state

4. **Medical records - how detailed?**
   - Just medications?
   - Full medical history?
   - Lab results?
   - Insurance needs parsing/OCR

---

## ✅ WHAT DEFINITELY WORKS

1. **Voice collection of medical history** ✅
   - You have voice agent
   - Can add new function: `collect_medical_history`
   - Store in FHIR Observations

2. **Secure document upload** ✅
   - Need to build endpoint
   - Use existing FHIR structure
   - Link to patient

3. **Wallet for premium management** ✅
   - Circle wallets exist
   - Can set up recurring payments
   - Can show plan info

4. **Stedi for verification** ✅
   - After they enroll, verify via Stedi
   - Check eligibility
   - Track claims

---

## ❌ WHAT DOESN'T WORK (As Currently Described)

1. **"Use Stedi to find insurance providers"** ❌
   - Stedi doesn't do this
   - Need Healthcare.gov or broker API

2. **"Sign them up"** ⚠️
   - Requires licensing OR broker partnership
   - Can't do directly without one of these

---

## 💭 MY RECOMMENDATION

**Start with Option C (Premium Management):**

1. Help uninsured users find insurance (referral)
2. Focus on **premium management** after enrollment
3. Use Stedi to verify and track
4. Build medical history collection
5. Add document upload

**Why:**
- ✅ Legal (no licensing)
- ✅ Uses existing infrastructure
- ✅ Still valuable service
- ✅ Can add enrollment later via partnership

**Revenue:**
- Small fee for premium management
- Or free, monetize other services

---

## 🚀 NEXT STEPS (If You Want to Proceed)

1. **Research Healthcare.gov API** - Can you get plan data?
2. **Research broker APIs** - HealthSherpa, Stride Health
3. **Build medical history collection** - New Retell function
4. **Build document upload** - Secure endpoint
5. **Design wallet UI** - Show plans, premiums, services

**Does this make sense?** The core idea is solid, but needs adjustment on the insurance finding/signup part.

