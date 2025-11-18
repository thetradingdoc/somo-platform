# Insurance Enrollment API Research - Can You Enroll Users Directly?

## 🎯 SHORT ANSWER

**YES, but with important caveats:**

1. ✅ **Enhanced Direct Enrollment (EDE)** - Healthcare.gov program allows approved partners to enroll users via API
2. ✅ **Broker APIs** - HealthSherpa, Stride Health can enroll users (you partner with them)
3. ❌ **Direct Insurer APIs** - Most insurers DON'T offer enrollment APIs (only data access APIs)
4. ⚠️ **Stedi** - Can verify eligibility/claims, but CANNOT enroll users

---

## 🔍 DETAILED FINDINGS

### **1. Enhanced Direct Enrollment (EDE) Program** ⭐ **BEST OPTION**

**What It Is:**
- Healthcare.gov program that allows **approved private entities** to enroll consumers in Qualified Health Plans
- You enroll users **directly through API** without redirecting them to Healthcare.gov
- You become an "EDE Partner"

**Requirements:**
- ✅ Must be approved by CMS (Centers for Medicare & Medicaid Services)
- ✅ Must meet security/compliance standards
- ✅ Must have proper infrastructure
- ✅ Application process (can take months)

**What You Can Do:**
- ✅ Submit enrollment applications via API
- ✅ Update applications
- ✅ Check application status
- ✅ Complete enrollment on behalf of users
- ✅ Handle all 50 states (federal marketplace)

**API Access:**
- Healthcare.gov provides APIs for EDE partners
- Can submit/update applications programmatically
- No redirect to Healthcare.gov needed

**Revenue:**
- You can charge fees (within regulations)
- Or provide as free service

**Link:** https://www.cms.gov/CCIIO/Programs-and-Initiatives/Health-Insurance-Marketplaces/Enhanced-Direct-Enrollment

---

### **2. Broker APIs (HealthSherpa, Stride Health)** ✅ **EASIER OPTION**

**HealthSherpa:**
- Licensed insurance broker
- Provides API for enrollment
- You partner with them
- They handle licensing/compliance
- You get commission

**Stride Health:**
- Similar to HealthSherpa
- API for enrollment
- Licensed broker
- Commission-based

**What You Can Do:**
- ✅ Enroll users via their API
- ✅ Get plan quotes
- ✅ Complete enrollment
- ✅ Get member IDs back

**Requirements:**
- ✅ Partner agreement
- ✅ API credentials
- ✅ Compliance with their terms

**Pros:**
- ✅ Faster than EDE approval
- ✅ They handle licensing
- ✅ Commission revenue

**Cons:**
- ❌ You pay commission to them
- ❌ Less control
- ❌ Dependent on partner

---

### **3. Direct Insurer APIs** ❌ **NOT FOR ENROLLMENT**

**What They Offer:**
- **Patient Access APIs** (FHIR) - Access member data, claims, clinical data
- **Eligibility APIs** - Check coverage (what you already do with Stedi)
- **Provider APIs** - For providers, not consumers

**What They DON'T Offer:**
- ❌ Enrollment APIs for consumers
- ❌ Plan quoting APIs
- ❌ Application submission APIs

**Examples:**
- Anthem - Has Patient Access API (data only)
- Blue Cross - Has FHIR APIs (data only)
- Cigna - Has APIs (data only)
- MVP Health Care - Has APIs (data only)

**Why:**
- Enrollment is regulated
- Requires licensing
- Insurers don't want to be enrollment platforms
- They rely on marketplaces/brokers

---

### **4. Stedi** ❌ **NOT FOR ENROLLMENT**

**What Stedi CAN Do:**
- ✅ Verify eligibility (270/271)
- ✅ Submit claims (837)
- ✅ Check claim status (276/277)
- ✅ Insurance discovery (find existing insurance)
- ✅ Connect to 3,400+ payers

**What Stedi CANNOT Do:**
- ❌ Enroll users in new insurance
- ❌ Quote insurance plans
- ❌ Submit enrollment applications
- ❌ Find insurance for uninsured users

**Why:**
- Stedi is for **eligibility/claims** (people who already have insurance)
- Not an enrollment platform
- Not a marketplace

---

## 🎯 YOUR OPTIONS (Ranked by Feasibility)

### **Option 1: Enhanced Direct Enrollment (EDE)** ⭐ **MOST POWERFUL**

**Process:**
1. Apply to CMS for EDE approval
2. Build infrastructure (security, compliance)
3. Get approved (3-6 months)
4. Integrate with Healthcare.gov APIs
5. Enroll users directly

**Pros:**
- ✅ Full control
- ✅ No broker fees
- ✅ Can charge fees
- ✅ All 50 states
- ✅ Direct API access

**Cons:**
- ❌ Long approval process
- ❌ Complex requirements
- ❌ Ongoing compliance

**Best For:**
- Long-term solution
- High volume
- Want full control

---

### **Option 2: Broker Partnership (HealthSherpa/Stride)** ✅ **FASTEST**

**Process:**
1. Contact HealthSherpa or Stride Health
2. Sign partnership agreement
3. Get API credentials
4. Integrate their API
5. Start enrolling users

**Pros:**
- ✅ Fast (weeks, not months)
- ✅ They handle licensing
- ✅ Commission revenue
- ✅ Proven APIs

**Cons:**
- ❌ Pay commission
- ❌ Less control
- ❌ Dependent on partner

**Best For:**
- Quick launch
- MVP
- Don't want to deal with licensing

---

### **Option 3: Hybrid Approach** 💡 **RECOMMENDED**

**Phase 1: Broker Partnership (Now)**
- Partner with HealthSherpa/Stride
- Start enrolling users immediately
- Learn the process
- Build user base

**Phase 2: EDE Application (Later)**
- Apply for EDE while using broker
- Once approved, migrate to direct enrollment
- Keep broker as backup

**Best For:**
- Most startups
- Want to launch fast
- Plan for long-term

---

## 📋 WHAT YOU NEED TO BUILD

### **For EDE:**
1. **Application to CMS**
   - Business plan
   - Security documentation
   - Compliance plan
   - Infrastructure details

2. **Infrastructure:**
   - Secure API endpoints
   - Data encryption
   - HIPAA compliance
   - Audit logging

3. **Integration:**
   - Healthcare.gov API integration
   - Application submission
   - Status tracking
   - Error handling

### **For Broker Partnership:**
1. **Partnership Agreement**
   - Contact HealthSherpa/Stride
   - Negotiate terms
   - Get API access

2. **Integration:**
   - API integration
   - Plan quoting
   - Enrollment submission
   - Status tracking

---

## 🔐 REGULATORY REQUIREMENTS

### **For EDE:**
- ✅ HIPAA compliance
- ✅ Security standards (SOC 2, etc.)
- ✅ Data encryption
- ✅ Audit logging
- ✅ CMS approval

### **For Broker Partnership:**
- ✅ HIPAA compliance (still required)
- ✅ Partner's compliance standards
- ✅ Data security
- ✅ User consent

---

## 💰 REVENUE MODELS

### **EDE Model:**
- Charge enrollment fee ($0-$50)
- Or free (monetize other services)
- Full control over pricing

### **Broker Model:**
- Commission from broker (typically $20-$50 per enrollment)
- Or charge user fee on top
- Shared revenue

---

## 🚀 RECOMMENDED PATH FORWARD

### **Immediate (Next 30 Days):**
1. **Research HealthSherpa API**
   - Check their developer docs
   - Contact for partnership
   - Understand requirements

2. **Research Stride Health API**
   - Compare with HealthSherpa
   - Choose best partner

3. **Build MVP Integration**
   - Plan quoting
   - Enrollment flow
   - Test with partner API

### **Short-term (3-6 Months):**
1. **Launch with Broker**
   - Start enrolling users
   - Learn the process
   - Build user base

2. **Apply for EDE** (if you want)
   - Start application process
   - Build infrastructure
   - Prepare for approval

### **Long-term (6-12 Months):**
1. **Get EDE Approval** (if applied)
2. **Migrate to Direct Enrollment**
3. **Keep Broker as Backup**

---

## ✅ SUMMARY

**Can you enroll users on behalf of them?**

**YES, through:**
1. ✅ **EDE Program** - Direct enrollment via Healthcare.gov API (requires approval)
2. ✅ **Broker APIs** - Enroll via HealthSherpa/Stride (requires partnership)

**NO, through:**
1. ❌ **Direct Insurer APIs** - They don't offer enrollment APIs
2. ❌ **Stedi** - Only for eligibility/claims, not enrollment

**Best Approach:**
- Start with broker partnership (fast)
- Apply for EDE in parallel (long-term)
- Use Stedi for verification after enrollment

---

## 📞 NEXT STEPS

1. **Contact HealthSherpa:**
   - Website: https://www.healthsherpa.com
   - Look for "Partner" or "API" section
   - Request partnership info

2. **Contact Stride Health:**
   - Website: https://www.stridehealth.com
   - Look for "Partners" or "API"
   - Request partnership info

3. **Research EDE:**
   - CMS website: https://www.cms.gov/CCIIO/Programs-and-Initiatives/Health-Insurance-Marketplaces/Enhanced-Direct-Enrollment
   - Review requirements
   - Decide if worth pursuing

4. **Build Integration:**
   - Start with broker API
   - Test enrollment flow
   - Integrate with voice agent

---

**Bottom Line:** You CAN enroll users, but you need either EDE approval OR broker partnership. Direct insurer APIs won't work for enrollment.

