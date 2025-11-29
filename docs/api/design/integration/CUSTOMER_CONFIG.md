# Customer Configuration System

**Purpose:** Allow customers to customize voice agent behavior and functionality.

---

## 🎯 Configuration Options

### Voice Agent Configuration

**1. Agent Prompt Customization**
- Custom system prompt for voice agent
- Clinic name, hours, specialties
- Branding/tone of voice

**2. Function Access Control**
- Enable/disable specific functions per customer
- Example: Customer A gets all functions, Customer B only gets appointments

**3. Default Behaviors**
- Default appointment duration
- Default provider name
- Default timezone
- Business hours

### API Configuration

**4. Rate Limits**
- Custom rate limits per customer (Enterprise)
- Different limits per endpoint

**5. Webhook Configuration**
- Webhook URLs per customer
- Which events to send
- Webhook retry settings

**6. White-Labeling**
- Custom domain per customer
- Custom email sender name
- Custom SMS sender name

---

## 🗄️ Database Schema

```sql
CREATE TABLE customer_configs (
  id TEXT PRIMARY KEY,
  customer_id TEXT UNIQUE NOT NULL,
  
  -- Voice Agent Config
  agent_prompt TEXT,                    -- Custom prompt override
  agent_name TEXT DEFAULT 'Kelly',      -- Agent name
  enabled_functions TEXT,               -- JSON array: ["schedule_appointment", "collect_insurance"]
  
  -- Default Values
  default_appointment_duration INTEGER DEFAULT 50,
  default_provider_name TEXT,
  default_timezone TEXT DEFAULT 'America/New_York',
  business_hours TEXT,                  -- JSON: {"monday": "9am-5pm", ...}
  
  -- API Config
  rate_limit_tier TEXT DEFAULT 'starter',
  custom_rate_limits TEXT,              -- JSON: {"appointments": 1000, ...}
  
  -- Webhook Config
  webhook_url TEXT,
  webhook_events TEXT,                  -- JSON array: ["appointment.created", ...]
  webhook_secret TEXT,                  -- For HMAC signature
  
  -- White-Label Config
  custom_domain TEXT,                   -- api.customerdomain.com
  email_sender_name TEXT DEFAULT 'DocLittle',
  sms_sender_name TEXT DEFAULT 'DocLittle',
  
  -- Feature Flags
  features TEXT,                        -- JSON: {"insurance_verification": true, ...}
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
```

---

## 🔧 Configuration Management

### Default Configuration

**When customer signs up:**
- Create default config with all functions enabled
- Use standard prompt
- Standard rate limits based on plan

### Configuration Updates

**Via API:**
```
PUT /api/v1/config
{
  "agent_name": "Sarah",
  "enabled_functions": ["schedule_appointment", "cancel_appointment"],
  "business_hours": {
    "monday": "9am-5pm",
    "tuesday": "9am-5pm",
    ...
  }
}
```

**Via Dashboard:**
- UI for configuring all settings
- Real-time preview of changes
- Test mode before applying

---

## 🚫 Function Access Control

### Available Functions

**Full List:**
```
1. collect_insurance           - Verify insurance
2. get_available_slots         - Get appointment times
3. schedule_appointment        - Book appointment
4. search_appointments         - Find appointments
5. confirm_appointment         - Confirm booking
6. cancel_appointment          - Cancel appointment
7. reschedule_appointment      - Reschedule appointment
8. create_appointment_checkout - Create payment checkout
9. verify_checkout_code        - Verify payment code
10. get_patient_claims         - Get insurance claims
```

### Access Control Strategy

**Option 1: All-or-Nothing**
- ✅ Simple
- ❌ Not flexible
- **Use Case:** Basic customers

**Option 2: Per-Function Control** ⭐ **RECOMMENDED**
- ✅ Flexible
- ✅ Customers pay for what they need
- ✅ Better security
- **Use Case:** Most customers

**Option 3: Role-Based**
- ✅ Enterprise-friendly
- ❌ More complex
- **Use Case:** Large customers with multiple teams

### Implementation

**Per-Function Control:**
- Store `enabled_functions` as JSON array in config
- Check function before allowing voice agent to call it
- Return error if function not enabled: "Function 'collect_insurance' is not enabled for your account"

**Function Validation:**
```javascript
// Pseudo-code
function validateFunctionAccess(customerId, functionName) {
  const config = getCustomerConfig(customerId);
  const enabledFunctions = config.enabled_functions || [];
  
  if (!enabledFunctions.includes(functionName)) {
    return {
      allowed: false,
      error: `Function '${functionName}' is not enabled. Please contact support to enable this feature.`
    };
  }
  
  return { allowed: true };
}
```

---

## 💰 Pricing Model Based on Functions

### Function Tiers

**Starter Plan ($99/month):**
- Includes: `schedule_appointment`, `cancel_appointment`, `search_appointments`
- Add-on: Insurance functions ($29/month)
- Add-on: Payment functions ($29/month)

**Professional Plan ($299/month):**
- All functions included
- Custom prompts
- Business hours

**Enterprise Plan ($999/month):**
- All functions
- Custom everything
- Dedicated support
- SLA guarantees

---

## 🎨 White-Labeling Options

### Domain Customization

**Option 1: Subdomain**
- Customer uses: `api.customerdomain.com`
- We handle DNS/CNAME
- SSL certificate via Let's Encrypt

**Option 2: Custom Path**
- Customer uses: `customerdomain.com/api/doclittle`
- We provide iframe/widget

**Option 3: Full White-Label** (Enterprise)
- Customer uses their own domain
- We manage DNS/SSL
- No DocLittle branding in API responses

### Branding Customization

**Email:**
- Sender name: "Customer Clinic" vs "DocLittle"
- Custom email templates (Enterprise)

**SMS:**
- Sender name: "Customer Clinic" vs "DocLittle"
- Custom SMS templates (Enterprise)

**Voice:**
- Custom agent name: "Sarah" vs "Kelly"
- Custom prompt/branding

---

## 🔍 Configuration Priority

### Priority Order

1. **Customer Config** (highest priority)
   - Overrides defaults
   - Per-customer settings

2. **Plan Defaults**
   - Based on plan tier
   - Applies if no customer config

3. **System Defaults** (lowest priority)
   - Default values for all customers
   - Fallback if nothing else

### Example

```
System Default: appointment_duration = 50 minutes
Plan Default (Starter): appointment_duration = 30 minutes
Customer Config: appointment_duration = 60 minutes

Result: Customer gets 60 minutes (customer config wins)
```

---

## 📋 Implementation Checklist

- [ ] Create `customer_configs` table
- [ ] Create default config on customer signup
- [ ] API endpoint: `GET /api/v1/config`
- [ ] API endpoint: `PUT /api/v1/config`
- [ ] Function access validation middleware
- [ ] Configuration merge logic (priority order)
- [ ] Dashboard UI for config management
- [ ] White-labeling setup (domains, DNS)
- [ ] Custom prompt editor
- [ ] Feature flag system

---

**Status:** 🚧 Design Phase  
**Next Step:** Review and approve before implementation

