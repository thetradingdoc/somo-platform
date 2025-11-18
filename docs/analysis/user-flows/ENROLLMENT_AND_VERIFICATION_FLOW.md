# Insurance Enrollment & Verification Flow - Detailed Explanation

## 🎯 The Flow (Step by Step)

### **STEP 1: User Calls - No Insurance** 📞

**Voice Agent:**
- "Hi, I'm Kelly. I understand you don't have insurance. I can help you find the right plan and manage your premium payments. Let's start with some basic information."

**Collects:**
- Name, phone, email
- Zip code (determines state marketplace)
- Income estimate (for subsidy eligibility)
- Medical history (medications, conditions)
- Preferred doctors/hospitals (if any)

---

### **STEP 2: Help Them Find Insurance** 🔍

**What You CAN Do:**
1. **Use Healthcare.gov API** (or broker API) to:
   - Get available plans in their zip code
   - Show plan options (premium, deductible, coverage)
   - Compare plans based on their medical needs
   - Calculate subsidies (if eligible)

2. **Voice Agent Says:**
   - "Based on your information, I found 3 plans that might work for you..."
   - "Plan A: $250/month, $5000 deductible, covers your medications"
   - "Plan B: $350/month, $2000 deductible, better coverage"
   - "Would you like me to send you a link to compare these plans?"

3. **Send SMS/Email:**
   - Link to Healthcare.gov with pre-filled info
   - OR Link to your partner broker (HealthSherpa, Stride)
   - OR Show plans in wallet app

**What You CANNOT Do (Without Licensing):**
- ❌ Actually enroll them in insurance
- ❌ Submit enrollment application for them
- ❌ Sign them up directly

**BUT - If You Partner with Broker:**
- ✅ You CAN enroll them through broker API
- ✅ Broker handles licensing
- ✅ You get commission

---

### **STEP 3: They Enroll (Two Scenarios)**

#### **Scenario A: They Enroll on Healthcare.gov** (You Don't Enroll Them)

1. User clicks your link → Goes to Healthcare.gov
2. They complete enrollment themselves
3. They get member ID from insurance company
4. **They come back to you** and provide member ID

#### **Scenario B: You Enroll Them via Broker Partner** (You DO Enroll Them)

1. User selects plan through your voice agent
2. You collect all enrollment info (SSN, income, etc.)
3. You call broker API (HealthSherpa/Stride) to enroll
4. Broker API returns member ID
5. Enrollment complete!

---

### **STEP 4: Verify with Stedi** ✅

**After They Have Member ID:**

1. **Voice Agent:**
   - "Great! I have your member ID. Let me verify your insurance is active."

2. **You Call Stedi:**
   ```javascript
   // Use Stedi to verify their insurance
   const eligibilityCheck = await InsuranceService.checkEligibility({
     patientName: "John Doe",
     memberId: "ABC123456", // From enrollment
     payerId: "BCBS", // Insurance company
     serviceCode: "90834", // Example service
     dateOfService: "2025-11-15"
   });
   ```

3. **Stedi Returns:**
   - ✅ Insurance is active
   - ✅ Copay: $20
   - ✅ Deductible: $2000
   - ✅ Coverage details

4. **You Store:**
   - Member ID in patient record
   - Insurance details
   - Verification status

**Why Verify with Stedi?**
- ✅ Confirms insurance is actually active
- ✅ Gets real benefit details (copay, deductible)
- ✅ Can check eligibility for specific services
- ✅ Prevents fraud (they can't fake member ID)

---

### **STEP 5: Set Up Premium Management in Wallet** 💰

**After Verification:**

1. **Voice Agent:**
   - "Perfect! Your insurance is verified. I can help you manage your monthly premium payments. Would you like to set that up?"

2. **You Set Up:**
   - Recurring payment in Circle wallet
   - Monthly premium amount (e.g., $250/month)
   - Payment date (usually 1st of month)
   - Link to insurance company payment system

3. **Wallet Shows:**
   - Current insurance plan
   - Monthly premium: $250
   - Next payment date: Dec 1, 2025
   - Payment history
   - Services covered

4. **User Can:**
   - See premium in wallet
   - Pay premium through wallet
   - Track payment history
   - See what services are covered

---

## 🔄 Complete Flow Example

### **Call 1: Initial (No Insurance)**

```
User: "I don't have insurance and need help"
Agent: "I can help! Let me collect some information..."
[Collects: name, zip, income, medical history]
Agent: "Based on your info, I found 3 plans. Let me send you a link to compare them."
[Sends SMS with link]
Agent: "After you enroll, call me back with your member ID and I'll set up premium management."
```

### **Call 2: After Enrollment (They Have Member ID)**

```
User: "I enrolled! My member ID is ABC123456"
Agent: "Great! Let me verify your insurance..."
[Verifies with Stedi]
Agent: "✅ Verified! Your insurance is active. Your monthly premium is $250. Would you like me to set up automatic payments in your wallet?"
User: "Yes"
Agent: "Perfect! I've set it up. You can see your premium and pay it through your wallet app."
```

---

## 💡 Key Points

### **What "Help Them Enroll" Means:**

**Option 1: Guidance Only (No Licensing Needed)**
- Show them plans
- Compare options
- Send them to Healthcare.gov
- They enroll themselves
- You verify after

**Option 2: Full Enrollment (Requires Broker Partnership)**
- Show them plans
- Collect enrollment info
- Call broker API to enroll
- Get member ID back
- You verify with Stedi
- Set up premium management

### **What "Verify with Stedi" Means:**

**After They Have Member ID:**
1. You call Stedi eligibility API
2. Stedi checks with insurance company
3. Returns: Is it active? What are benefits?
4. You store this info
5. Now you can manage their premium

**Why This Matters:**
- ✅ Confirms insurance is real
- ✅ Gets actual benefit details
- ✅ Can check coverage for services
- ✅ Prevents fraud

---

## 🎯 So Your Flow Would Be:

### **Phase 1: Enrollment Assistance**
1. Voice agent collects info
2. Find plans (Healthcare.gov or broker API)
3. Show/compare plans
4. **Either:**
   - Send to Healthcare.gov (they enroll)
   - OR Enroll via broker API (you enroll)

### **Phase 2: Verification**
1. They provide member ID (or you get it from broker)
2. You verify with Stedi
3. Store insurance details

### **Phase 3: Premium Management**
1. Set up recurring payment in wallet
2. Show premium in wallet
3. User can pay through wallet
4. Track payment history

---

## ❓ Questions Answered

**Q: Can we enroll them?**
- **A:** Only if you partner with licensed broker (HealthSherpa, Stride). Otherwise, you guide them to Healthcare.gov.

**Q: What does Stedi verify?**
- **A:** That their insurance is active and what benefits they have (copay, deductible, coverage).

**Q: When do we verify?**
- **A:** AFTER they enroll and have a member ID. Stedi can't verify insurance that doesn't exist yet.

**Q: Can we manage premium before verification?**
- **A:** Technically yes, but risky. Better to verify first to ensure insurance is real.

---

## ✅ Summary

**"Help them enroll"** = Guide them to find/compare plans, then either:
- They enroll on Healthcare.gov (you guide)
- OR You enroll them via broker API (if partnered)

**"Verify with Stedi"** = After enrollment, check that:
- Insurance is active
- Get benefit details
- Store for premium management

**"Manage premium"** = Set up recurring payment in wallet after verification

Does this clarify the flow?

