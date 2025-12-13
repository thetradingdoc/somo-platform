# Clinic Onboarding Summary

**Question**: What do we need to onboard a new agent (clinic) into our system?

**Answer**: 8 steps, ~15-20 minutes manually, ~2-3 minutes when automated

---

## 🎯 Quick Answer

To onboard **Tenant 2 (clinic)**, you need:

1. **Clinic Database Record** ✅ (exists)
2. **Retell Agent** ⚠️ (manual - needs automation)
3. **Phone Number** ⚠️ (manual - needs automation)
4. **Prompt Template** ❌ (missing - needs implementation)
5. **Tenant Configuration** ❌ (missing - needs implementation)
6. **Billing Setup** ❌ (missing - needs implementation)
7. **Integrations** ✅ (exists but needs tenant-scoping)
8. **Testing** ✅ (test scripts exist)

---

## 📋 What You Have vs. What You Need

### ✅ What Exists (Ready to Use)

1. **Database Schema**
   - `clinics` table with all fields
   - `clinic_phone_numbers` table
   - Multi-tenant support in most tables
   - `db.createClinic()` function works

2. **Services**
   - `RetellService.createAgent()` method exists
   - `TwilioPhoneService` exists
   - Call routing works (phone → clinic lookup)
   - Data isolation implemented

3. **Infrastructure**
   - WebSocket handler for Retell
   - Voice routes with clinic context
   - Multi-tenant routing

### ⚠️ What's Partially Ready (Needs Manual Work)

1. **Retell Agent Creation**
   - ✅ `RetellService.createAgent()` method exists
   - ❌ Not automated - must call manually
   - ❌ No API endpoint

2. **Phone Number Provisioning**
   - ✅ `TwilioPhoneService` exists
   - ❌ Not automated - must use Twilio dashboard
   - ❌ No API endpoint

### ❌ What's Missing (Needs Implementation)

1. **Prompt Template Management**
   - ❌ No `prompt_templates` table
   - ❌ No version control
   - ❌ No prompt builder UI

2. **Tenant Configuration**
   - ❌ No `tenant_config` table
   - ❌ No configuration UI
   - ⚠️ Basic fields in `clinics` table only

3. **Billing Integration**
   - ❌ No Stripe customer creation on clinic creation
   - ❌ No subscription management
   - ❌ No automated billing setup

4. **Onboarding API**
   - ❌ No `POST /api/admin/clinics` endpoint
   - ❌ No automated provisioning flow

---

## 🚀 Immediate Action Plan

### For Tenant 2 (clinic) - Manual Onboarding

**Time**: 15-20 minutes

1. **Create Clinic Record** (2 min)
```javascript
const clinic = {
  clinic_id: 'clinic-' + uuidv4(),
  name: 'New Clinic',
  slug: 'clinic',
  phone_number: null,  // Will add in step 3
  email: 'admin@clinic.com',
  address: '123 Main St',
  business_hours: 'Monday-Friday, 9 AM - 5 PM',
  services: JSON.stringify(['Mental Health', 'Primary Care']),
  retell_agent_id: null,  // Will set in step 2
  retell_agent_status: 'pending',
  merchant_id: null,
  is_active: true
};

db.createClinic(clinic);
```

2. **Create Retell Agent** (5 min)
   - Go to Retell Dashboard
   - Create new agent
   - Name: "Clinic Receptionist - New Clinic"
   - Webhook: `wss://doclittle.site/webhook/retell/llm`
   - Prompt: Use `RetellService.generateClinicPrompt(clinic)`
   - Copy `agent_id`
   - Update: `db.updateClinic(clinic.clinic_id, { retell_agent_id: 'agent_xxx', retell_agent_status: 'active' })`

3. **Provision Phone Number** (5 min)
   - Go to Twilio Console
   - Buy number (e.g., +15551234567)
   - Configure webhook: `https://doclittle.site/voice/incoming`
   - Store: `db.createClinicPhoneNumber({ phone_number: '+15551234567', clinic_id: clinic.clinic_id, is_primary: true })`

4. **Test** (3 min)
   - Call the phone number
   - Verify call routes correctly
   - Test appointment booking

**Total**: ~15 minutes

---

## 🔧 What Needs to Be Built (Automation)

### Priority 1: Automated Onboarding Service

**File**: `services/clinic-onboarding-service.js`

**Methods Needed**:
```javascript
class ClinicOnboardingService {
  async onboardClinic(clinicData) {
    // 1. Create clinic record
    // 2. Provision Retell agent
    // 3. Provision phone number
    // 4. Setup billing
    // 5. Return complete clinic object
  }
  
  async provisionRetellAgent(clinicId) {
    // Call RetellService.createAgent()
    // Store agent_id in database
  }
  
  async provisionPhoneNumber(clinicId) {
    // Call TwilioPhoneService.buyNumber()
    // Configure webhook
    // Store in database
  }
  
  async setupBilling(clinicId) {
    // Create Stripe customer
    // Create subscription
    // Link to clinic
  }
}
```

**API Endpoint**:
```javascript
POST /api/admin/clinics
{
  name: "New Clinic",
  slug: "clinic",
  email: "admin@clinic.com",
  // ... other fields
}
```

**Response**: Complete clinic object with all IDs

### Priority 2: Prompt Template System

**Database Table**:
```sql
CREATE TABLE prompt_templates (
  id TEXT PRIMARY KEY,
  voice_agent_id TEXT,  -- Links to clinic
  version INTEGER,
  content TEXT,
  status TEXT,  -- 'draft' | 'active' | 'archived'
  created_at DATETIME
);
```

**Features**:
- Version control
- Rollback capability
- Template hydration (replace placeholders)

### Priority 3: Tenant Configuration

**Database Table**:
```sql
CREATE TABLE tenant_config (
  tenant_id TEXT PRIMARY KEY,
  business_profile TEXT,
  persona TEXT,
  hours TEXT,
  appointment_types TEXT,
  intake_rules TEXT,
  insurance_rules TEXT,
  billing_faqs TEXT,
  general_faqs TEXT
);
```

---

## 📊 Current System Capabilities

### ✅ Can Do Right Now

- Create clinic in database
- Route calls by phone number
- Isolate data by clinic_id
- Use existing Retell agent (shared)
- Use existing phone number (shared)

### ⚠️ Can Do Manually

- Create Retell agent per clinic
- Provision phone number per clinic
- Configure integrations per clinic

### ❌ Cannot Do Yet

- Automated onboarding
- Prompt versioning
- Tenant-specific configuration UI
- Automated billing setup

---

## 🎯 Minimum Requirements for New Clinic

**Absolute Minimum** (to get a clinic working):

1. ✅ Clinic record in database
2. ⚠️ Retell agent (can use shared agent temporarily)
3. ⚠️ Phone number (can use existing number temporarily)
4. ✅ Call routing (already works)

**Recommended** (for production):

1. ✅ Clinic record
2. ✅ Dedicated Retell agent
3. ✅ Dedicated phone number
4. ✅ Prompt template
5. ✅ Tenant configuration
6. ✅ Billing setup
7. ✅ Integrations
8. ✅ Testing

---

## 🔄 Comparison: Tenant 1 vs. Tenant 2

### Tenant 1 (akin-dunbar) - Current Setup

- ✅ Clinic record exists
- ✅ Retell agent configured (shared or dedicated?)
- ✅ Phone number configured
- ✅ Subdomain routing works
- ✅ Data isolation works

### Tenant 2 (clinic) - Needs Setup

- ❌ Clinic record (needs creation)
- ❌ Retell agent (needs creation)
- ❌ Phone number (needs provisioning)
- ❌ Subdomain routing (needs DNS/config)
- ✅ Data isolation (will work once clinic_id is set)

---

## 📝 Next Steps

### Immediate (Today)

1. **Create clinic record** for "clinic"
2. **Manually create Retell agent** (or use shared)
3. **Manually provision phone number** (or use existing)
4. **Test call routing**

### Short-term (This Week)

1. **Build onboarding service** (`ClinicOnboardingService`)
2. **Create API endpoint** (`POST /api/admin/clinics`)
3. **Automate Retell agent creation**
4. **Automate phone provisioning**

### Medium-term (This Month)

1. **Build prompt template system**
2. **Build tenant configuration system**
3. **Build billing automation**
4. **Build admin dashboard**

---

## 🔗 Related Files

- **Full Checklist**: `CLINIC_ONBOARDING_CHECKLIST.md`
- **Multi-Tenant Architecture**: `../architecture/multi-tenant/MULTI_TENANT_VOICE_AGENT.md`
- **Retell Service**: `../../middleware-platform/services/retell-service.js`
- **Database Functions**: `../../middleware-platform/database.js` (lines 3642+)

---

**Last Updated**: January 27, 2025  
**Status**: Manual onboarding works, automation in progress

