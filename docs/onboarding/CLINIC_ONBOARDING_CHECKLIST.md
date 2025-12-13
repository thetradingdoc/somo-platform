# Clinic Onboarding Checklist

**Purpose**: Complete guide for onboarding a new clinic (tenant) into the DocLittle platform  
**Current Tenants**: 
- Tenant 1: `akin-dunbar` (existing)
- Tenant 2: `clinic` (new - to be onboarded)

---

## 📋 Overview

To onboard a new clinic, you need to:

1. **Create Clinic Record** (Database)
2. **Provision Retell Agent** (One agent per clinic)
3. **Create Prompt Template** (Version-controlled)
4. **Configure Tenant Settings** (Business profile, hours, etc.)
5. **Provision Phone Number** (Twilio or Retell)
6. **Set Up Integrations** (Google Calendar, etc.)
7. **Configure Billing** (Stripe subscription)
8. **Test & Verify** (End-to-end testing)

---

## ✅ Step-by-Step Onboarding Process

### Step 1: Create Clinic Database Record

**What**: Create the clinic entry in the `clinics` table

**Required Information**:
- Clinic name
- Slug (URL-friendly identifier, e.g., "clinic")
- Phone number (optional - can add later)
- Email
- Address
- Business hours
- Services offered

**Database Fields**:
```sql
INSERT INTO clinics (
  clinic_id,
  name,
  slug,
  phone_number,
  email,
  address,
  business_hours,
  services,
  retell_agent_id,        -- Will be set in Step 2
  retell_agent_status,    -- 'pending' → 'active'
  merchant_id,            -- Will be set in Step 4
  is_active
) VALUES (...)
```

**Current Implementation**:
- ✅ `db.createClinic()` function exists
- ✅ Table structure supports multi-tenant
- ⚠️ **Missing**: Automated clinic creation endpoint

**Action Needed**:
- Create `POST /api/admin/clinics` endpoint OR
- Use existing `db.createClinic()` directly

---

### Step 2: Provision Retell Agent

**What**: Create a dedicated Retell agent for this clinic

**Why**: One agent per clinic = isolation, custom prompts, easier debugging

**Required**:
- Retell API key (already configured)
- Clinic-specific prompt template
- WebSocket URL for LLM handler

**Retell Agent Creation**:
```javascript
POST https://api.retellai.com/create-agent
{
  "agent_name": "Clinic Receptionist - [Clinic Name]",
  "voice_id": "openai-Alloy",
  "language": "en-US",
  "llm_websocket_url": "wss://doclittle.site/webhook/retell/llm",
  "general_prompt": "[Hydrated prompt from template + config]",
  "enable_backchannel: true,
  "ambient_sound": "office"
}
```

**Response**: `{ agent_id: "agent_abc123..." }`

**Store in Database**:
```sql
UPDATE clinics 
SET retell_agent_id = 'agent_abc123',
    retell_agent_status = 'active'
WHERE clinic_id = 'clinic-xxx'
```

**Current Implementation**:
- ✅ `RetellService` class exists
- ✅ `generateClinicPrompt()` method exists
- ⚠️ **Missing**: Automated agent provisioning method
- ⚠️ **Missing**: Agent creation API call

**Action Needed**:
- Add `RetellService.createAgentForClinic(clinicId)` method
- Call Retell API to create agent
- Store `retell_agent_id` in database

---

### Step 3: Create Prompt Template

**What**: Create version-controlled prompt template for the clinic

**Why**: Allows prompt customization, versioning, rollback

**Template Structure**:
```
prompt_templates (
  id,
  voice_agent_id,        -- Links to clinic's voice agent
  version,               -- 1, 2, 3...
  content,               -- Full prompt text
  status,                -- 'draft' | 'active' | 'archived'
  created_at
)
```

**Prompt Assembly**:
1. Load base template (Kelly's prompt)
2. Hydrate with clinic data:
   - `{{CLINIC_NAME}}` → Clinic name
   - `{{BUSINESS_HOURS}}` → Clinic hours
   - `{{PHONE_NUMBER}}` → Clinic phone
   - `{{ADDRESS}}` → Clinic address
3. Add tenant-specific overrides (tone, FAQs, etc.)
4. Store as version 1

**Current Implementation**:
- ✅ Base prompt template exists (`kelly-voice-agent-prompt.md`)
- ✅ `RetellService.generateClinicPrompt()` exists
- ❌ **Missing**: Prompt template database table
- ❌ **Missing**: Version control system
- ❌ **Missing**: Prompt builder UI

**Action Needed**:
- Create `prompt_templates` table
- Create `tenant_config` table (for overrides)
- Implement prompt versioning logic
- Build prompt builder UI (Phase 2)

---

### Step 4: Configure Tenant Settings

**What**: Set up clinic-specific configuration

**Configuration Includes**:
- Business profile (name, description, services)
- Persona (friendly, professional, calm)
- Business hours
- Appointment types
- Intake rules
- Insurance rules
- Billing questions & answers
- FAQ library
- Special instructions

**Database Structure**:
```sql
tenant_config (
  tenant_id,             -- Links to clinic
  voice_agent_id,        -- Links to voice agent
  business_name,
  business_description,
  persona,
  hours,
  appointment_types,
  intake_rules,
  insurance_rules,
  billing_faqs,
  general_faqs,
  special_instructions,
  created_at,
  updated_at
)
```

**Current Implementation**:
- ✅ `clinics` table has basic fields
- ❌ **Missing**: `tenant_config` table
- ❌ **Missing**: Configuration UI

**Action Needed**:
- Create `tenant_config` table
- Build configuration UI (Phase 2)
- For now: Use `clinics` table fields

---

### Step 5: Provision Phone Number

**What**: Assign a phone number to the clinic

**Options**:
1. **Twilio** (Recommended)
   - Buy number via Twilio API
   - Configure webhook: `https://doclittle.site/voice/incoming`
   - Store in `clinic_phone_numbers` table

2. **Retell** (Alternative)
   - Use Retell's phone number provisioning
   - Configure in Retell dashboard

**Phone Number Mapping**:
```sql
clinic_phone_numbers (
  phone_number,          -- +15551234567
  clinic_id,             -- Links to clinic
  is_primary,            -- true/false
  twilio_phone_sid,      -- Twilio SID (if using Twilio)
  retell_phone_id,       -- Retell ID (if using Retell)
  created_at
)
```

**Webhook Configuration**:
- All phone numbers point to: `POST /voice/incoming`
- Backend identifies clinic by `To` number
- Routes call to correct Retell agent

**Current Implementation**:
- ✅ `clinic_phone_numbers` table exists
- ✅ `TwilioPhoneService` exists
- ✅ `db.createClinicPhoneNumber()` exists
- ⚠️ **Missing**: Automated phone provisioning endpoint

**Action Needed**:
- Create `POST /api/admin/clinics/:id/phone-numbers` endpoint
- Or use `TwilioPhoneService.provisionNumber()` directly

---

### Step 6: Set Up Integrations

**What**: Configure third-party integrations

**Common Integrations**:
1. **Google Calendar**
   - OAuth flow
   - Store refresh token
   - Link to clinic

2. **Stedi** (Insurance)
   - API key configuration
   - Payer list sync

3. **Circle** (USDC Payments)
   - Wallet creation
   - Entity configuration

4. **Stripe** (Payments)
   - Merchant account
   - Webhook configuration

**Current Implementation**:
- ✅ Google Calendar OAuth exists
- ✅ Stedi integration exists
- ✅ Circle service exists
- ✅ Stripe integration exists
- ⚠️ **Missing**: Tenant-scoped integration storage

**Action Needed**:
- Create `tenant_integrations` table
- Store integration credentials per tenant
- Build integration UI (Phase 2)

---

### Step 7: Configure Billing

**What**: Set up Stripe subscription and billing

**Billing Components**:
1. **Stripe Customer**
   - Create customer in Stripe
   - Store `stripe_customer_id` in `clinics` table

2. **Subscription**
   - Choose plan (Starter, Pro, Enterprise)
   - Create subscription
   - Store `stripe_subscription_id`

3. **Usage Tracking**
   - Set up usage records
   - Configure quotas
   - Set up alerts

**Database Fields**:
```sql
-- Add to clinics table:
stripe_customer_id,
stripe_subscription_id,
plan_tier,              -- 'starter' | 'pro' | 'enterprise'
billing_status,         -- 'active' | 'trial' | 'suspended'
```

**Current Implementation**:
- ✅ Stripe integration exists
- ✅ Usage tracking exists
- ❌ **Missing**: Tenant billing setup
- ❌ **Missing**: Subscription management

**Action Needed**:
- Create Stripe customer on clinic creation
- Set up subscription
- Link to clinic record

---

### Step 8: Test & Verify

**What**: End-to-end testing of the onboarding

**Test Checklist**:
- [ ] Clinic record created in database
- [ ] Retell agent created and active
- [ ] Phone number provisioned and working
- [ ] Call routing works (phone → clinic → agent)
- [ ] Prompt loads correctly
- [ ] Appointments can be scheduled
- [ ] Data isolation works (clinic A can't see clinic B's data)
- [ ] Billing is configured
- [ ] Integrations work

**Current Implementation**:
- ✅ Test scripts exist (`test-tenant-isolation.js`)
- ✅ Voice agent tests exist
- ⚠️ **Missing**: Automated onboarding test

**Action Needed**:
- Create `test-clinic-onboarding.js` script
- Test full onboarding flow

---

## 🔧 Current System Status

### ✅ What Exists

1. **Database Schema**
   - ✅ `clinics` table
   - ✅ `clinic_phone_numbers` table
   - ✅ Multi-tenant support in most tables

2. **Services**
   - ✅ `RetellService` (partial)
   - ✅ `TwilioPhoneService`
   - ✅ `BookingService` (clinic-scoped)
   - ✅ `FHIRService` (clinic-scoped)

3. **Infrastructure**
   - ✅ WebSocket handler for Retell
   - ✅ Voice routes with clinic context
   - ✅ Multi-tenant routing

### ❌ What's Missing

1. **Automated Provisioning**
   - ❌ No automated Retell agent creation
   - ❌ No automated phone provisioning endpoint
   - ❌ No onboarding API endpoint

2. **Prompt Management**
   - ❌ No `prompt_templates` table
   - ❌ No version control
   - ❌ No prompt builder UI

3. **Configuration Management**
   - ❌ No `tenant_config` table
   - ❌ No configuration UI

4. **Billing Integration**
   - ❌ No Stripe customer creation on clinic creation
   - ❌ No subscription management

---

## 🚀 Quick Start: Manual Onboarding (Current State)

Since automated provisioning isn't ready, here's how to manually onboard a clinic:

### Manual Process

1. **Create Clinic Record**:
```javascript
const clinic = {
  clinic_id: 'clinic-' + uuidv4(),
  name: 'New Clinic',
  slug: 'clinic',  // URL-friendly: clinic.doclittle.site
  phone_number: '+15551234567',
  email: 'admin@clinic.com',
  address: '123 Main St',
  business_hours: 'Monday-Friday, 9 AM - 5 PM',
  services: JSON.stringify(['Mental Health', 'Primary Care']),
  retell_agent_id: null,  // Will be set in step 2
  retell_agent_status: 'pending',
  merchant_id: null,  // Will be set later
  is_active: true
};

db.createClinic(clinic);
```

2. **Create Retell Agent** (Manual):
   - Go to Retell Dashboard
   - Create new agent
   - Set name: "Clinic Receptionist - [Clinic Name]"
   - Set webhook: `wss://doclittle.site/webhook/retell/llm`
   - Set prompt: Use `RetellService.generateClinicPrompt(clinic)`
   - Copy `agent_id`
   - Update clinic: `db.updateClinic(clinic.clinic_id, { retell_agent_id: 'agent_xxx' })`

3. **Provision Phone Number** (Manual):
   - Go to Twilio Console
   - Buy number
   - Configure webhook: `https://doclittle.site/voice/incoming`
   - Store in database:
   ```javascript
   db.createClinicPhoneNumber({
     phone_number: '+15551234567',
     clinic_id: clinic.clinic_id,
     is_primary: true
   });
   ```

4. **Test**:
   - Call the phone number
   - Verify call routes to correct clinic
   - Verify Retell agent responds
   - Test appointment booking

---

## 📝 Implementation Roadmap

### Phase 1: Automated Onboarding (Week 1-2)

**Priority**: High (needed for scaling)

1. **Create Onboarding Service**
   - `services/clinic-onboarding-service.js`
   - Methods:
     - `onboardClinic(clinicData)`
     - `provisionRetellAgent(clinicId)`
     - `provisionPhoneNumber(clinicId)`
     - `setupBilling(clinicId)`

2. **Create API Endpoints**
   - `POST /api/admin/clinics` - Create clinic
   - `POST /api/admin/clinics/:id/provision-agent` - Provision Retell agent
   - `POST /api/admin/clinics/:id/provision-phone` - Provision phone number
   - `POST /api/admin/clinics/:id/setup-billing` - Setup billing

3. **Enhance RetellService**
   - Add `createAgentForClinic(clinicId)` method
   - Call Retell API to create agent
   - Store agent ID in database

4. **Enhance TwilioPhoneService**
   - Add `provisionNumberForClinic(clinicId)` method
   - Buy number via Twilio API
   - Configure webhook
   - Store in database

### Phase 2: Prompt Management (Week 3-4)

**Priority**: Medium (improves customization)

1. **Create Prompt Templates Table**
   - `prompt_templates` table
   - Version control
   - Status tracking

2. **Create Tenant Config Table**
   - `tenant_config` table
   - Business profile
   - Custom settings

3. **Build Prompt Builder UI**
   - Template editor
   - Version comparison
   - Rollback functionality

### Phase 3: Configuration UI (Week 5-6)

**Priority**: Medium (improves UX)

1. **Build Tenant Dashboard**
   - Configuration page
   - Integration management
   - Billing management

2. **Build Admin Dashboard**
   - Clinic management
   - Bulk operations
   - Monitoring

---

## 🎯 Minimum Viable Onboarding (MVP)

For immediate clinic onboarding, you need:

1. ✅ **Database record** - `db.createClinic()` works
2. ⚠️ **Retell agent** - Manual creation in Retell dashboard
3. ⚠️ **Phone number** - Manual provisioning in Twilio
4. ✅ **Call routing** - Already works (phone → clinic lookup)
5. ✅ **Data isolation** - Already implemented

**Time to onboard**: ~15-20 minutes (manual)

**With automation**: ~2-3 minutes (future)

---

## 📊 Comparison: Current vs. Target

| Component | Current State | Target State |
|-----------|--------------|--------------|
| **Clinic Creation** | Manual DB insert | Automated API endpoint |
| **Retell Agent** | Manual dashboard | Automated API call |
| **Phone Number** | Manual Twilio | Automated provisioning |
| **Prompt Template** | File-based | Database + versioning |
| **Configuration** | Basic fields | Full tenant config |
| **Billing** | Manual Stripe | Automated subscription |
| **Testing** | Manual | Automated test suite |

---

## 🔗 Related Documentation

- **Multi-Tenant Architecture**: `../architecture/multi-tenant/MULTI_TENANT_VOICE_AGENT.md`
- **Retell Configuration**: `../middleware-platform/RETELL_CONFIG_QUICK_REFERENCE.md`
- **Database Schema**: `../architecture/database/DATABASE_SCHEMA_APPROACH.md`
- **Payment Architecture**: `../architecture/payments/PAYMENT_ARCHITECTURE.md`

---

## ✅ Quick Reference: Onboarding Checklist

### For New Clinic "clinic"

- [ ] **Step 1**: Create clinic record in database
  - Name: "New Clinic"
  - Slug: "clinic"
  - Phone: TBD
  - Email: TBD

- [ ] **Step 2**: Create Retell agent
  - Agent name: "Clinic Receptionist - New Clinic"
  - Webhook: `wss://doclittle.site/webhook/retell/llm`
  - Prompt: Generated from template
  - Store `retell_agent_id` in database

- [ ] **Step 3**: Create prompt template (version 1)
  - Load base template
  - Hydrate with clinic data
  - Store in database (when table exists)

- [ ] **Step 4**: Configure tenant settings
  - Business hours
  - Services
  - Appointment types
  - Store in `tenant_config` (when table exists)

- [ ] **Step 5**: Provision phone number
  - Buy via Twilio
  - Configure webhook
  - Store in `clinic_phone_numbers`

- [ ] **Step 6**: Set up integrations
  - Google Calendar (if needed)
  - Stedi (if needed)
  - Circle (if needed)

- [ ] **Step 7**: Configure billing
  - Create Stripe customer
  - Create subscription
  - Link to clinic

- [ ] **Step 8**: Test
  - Call phone number
  - Verify routing
  - Test appointment booking
  - Verify data isolation

---

**Last Updated**: January 27, 2025  
**Status**: Manual onboarding works, automation in progress

