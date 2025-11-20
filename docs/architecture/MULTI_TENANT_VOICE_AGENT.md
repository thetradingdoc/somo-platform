# Multi-Tenant Voice Agent Architecture

## Current Setup (Single Tenant)

```
Patient Calls → Twilio → /voice/incoming → Retell Agent → WebSocket → Backend
```

**Current Flow:**
1. Patient calls Twilio number
2. Twilio sends webhook to `/voice/incoming`
3. Backend registers call with Retell using ONE agent ID
4. Retell connects via WebSocket
5. All calls use same agent, same merchant_id

---

## Multi-Tenant Architecture

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Clinic A (doclittle.site/clinicA)                     │
│  - Twilio Number: +1-555-0100                           │
│  - Retell Agent: agent_clinicA                         │
│  - Merchant ID: clinicA-merchant-id                    │
└─────────────────────────────────────────────────────────┘
                        │
                        │ Call comes in
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Twilio Webhook                                         │
│  /voice/incoming                                         │
│  - Receives: To number (+1-555-0100)                    │
│  - Looks up: Which clinic owns this number?             │
│  - Identifies: Clinic A                                 │
└─────────────────────────────────────────────────────────┘
                        │
                        │ Route to correct tenant
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Backend Processing                                     │
│  - Uses Clinic A's Retell Agent ID                      │
│  - Uses Clinic A's Merchant ID                          │
│  - Stores data in Clinic A's namespace                  │
└─────────────────────────────────────────────────────────┘
                        │
                        │ WebSocket connection
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Retell Agent (Clinic A)                                │
│  - Has Clinic A's custom prompt                         │
│  - Uses Clinic A's functions                            │
│  - Returns Clinic A's data                              │
└─────────────────────────────────────────────────────────┘
```

---

## Step-by-Step Multi-Tenant Setup

### Step 1: Phone Number to Tenant Mapping

**Problem:** When a call comes in, how do we know which clinic it's for?

**Solution:** Map Twilio phone numbers to clinics

```
Database Table: clinic_phone_numbers
┌─────────────┬──────────────┬──────────────┬─────────────┐
│ phone_number│ clinic_id    │ clinic_name  │ tenant_slug │
├─────────────┼──────────────┼──────────────┼─────────────┤
│ +15550100   │ clinic-001   │ Clinic A     │ clinicA     │
│ +15550101   │ clinic-002   │ Clinic B     │ clinicB     │
│ +15550102   │ clinic-003   │ Clinic C     │ clinicC     │
└─────────────┴──────────────┴──────────────┴─────────────┘
```

**Flow:**
1. Call comes to `+1-555-0100`
2. Backend queries: "Which clinic owns +1-555-0100?"
3. Result: "Clinic A"
4. Backend uses Clinic A's configuration

---

### Step 2: Retell Agent Per Clinic

**Option A: One Agent Per Clinic (Recommended)**
- Each clinic has their own Retell agent
- Clinic A: `agent_clinicA_123`
- Clinic B: `agent_clinicB_456`
- Clinic C: `agent_clinicC_789`

**Option B: One Agent with Dynamic Variables**
- Single Retell agent for all clinics
- Pass `clinic_id` as dynamic variable
- Agent uses clinic_id to customize behavior

**Recommendation:** Option A (separate agents) for:
- Better isolation
- Custom prompts per clinic
- Easier troubleshooting
- Independent agent updates

---

### Step 3: Tenant Identification in Webhook

**Current Code:**
```javascript
app.post('/voice/incoming', async (req, res) => {
  const toNumber = req.body.To;  // Twilio number called
  const fromNumber = req.body.From;  // Patient's number
  
  // Currently uses single agent:
  const agentId = process.env.RETELL_AGENT_ID;
  
  // Currently uses single merchant:
  const merchantId = process.env.MERCHANT_ID;
})
```

**Multi-Tenant Code (Conceptual):**
```javascript
app.post('/voice/incoming', async (req, res) => {
  const toNumber = req.body.To;  // +1-555-0100
  const fromNumber = req.body.From;  // Patient's number
  
  // STEP 1: Identify tenant from phone number
  const clinic = db.getClinicByPhoneNumber(toNumber);
  // Returns: { clinic_id: 'clinic-001', name: 'Clinic A', ... }
  
  // STEP 2: Get clinic-specific Retell agent
  const agentId = clinic.retell_agent_id;  // agent_clinicA_123
  
  // STEP 3: Get clinic-specific merchant ID
  const merchantId = clinic.merchant_id;  // clinicA-merchant-id
  
  // STEP 4: Register with Retell using clinic's agent
  const registerPayload = {
    agent_id: agentId,  // Clinic A's agent
    metadata: {
      clinic_id: clinic.clinic_id,
      clinic_name: clinic.name,
      merchant_id: merchantId
    }
  };
})
```

---

### Step 4: Data Isolation

**Problem:** How do we ensure Clinic A's data doesn't mix with Clinic B's?

**Solution:** Tenant-scoped database queries

**Current:**
```javascript
// Gets ALL patients
const patients = db.getAllPatients();
```

**Multi-Tenant:**
```javascript
// Gets ONLY Clinic A's patients
const patients = db.getPatientsByClinic(clinicId);
```

**Database Schema:**
```
fhir_patients table:
┌─────────────┬──────────────┬─────────────┐
│ patient_id  │ clinic_id    │ name        │
├─────────────┼──────────────┼─────────────┤
│ patient-001 │ clinic-001   │ John Doe    │
│ patient-002 │ clinic-001   │ Jane Smith  │
│ patient-003 │ clinic-002   │ Bob Jones   │
└─────────────┴──────────────┴─────────────┘
```

**All tables need `clinic_id`:**
- `fhir_patients` → `clinic_id`
- `appointments` → `clinic_id`
- `insurance_claims` → `clinic_id`
- `eligibility_checks` → `clinic_id`
- `users` → `clinic_id`

---

### Step 5: Retell WebSocket Handler

**Current:** Single handler for all calls

**Multi-Tenant:** Handler needs clinic context

**Flow:**
1. WebSocket connects with `call_id`
2. Look up call in database to get `clinic_id`
3. Use `clinic_id` for all function calls
4. All data operations scoped to that clinic

**Example:**
```javascript
// When Retell calls schedule_appointment function
async handleScheduleAppointment(callId, args) {
  // STEP 1: Get clinic from call
  const call = db.getCall(callId);
  const clinicId = call.clinic_id;
  
  // STEP 2: All operations scoped to clinic
  const appointment = await BookingService.scheduleAppointment({
    ...args,
    clinic_id: clinicId  // Ensures appointment belongs to Clinic A
  });
  
  // STEP 3: Check Clinic A's calendar (not Clinic B's)
  const calendar = BookingService.getCalendarClient(clinicId);
}
```

---

### Step 5.1: Clinic Context Enforcement

- All `/voice/appointments/*` endpoints now require `clinic_id` in the payload or `x-clinic-id` header.
- The Retell WebSocket handler injects the caller’s clinic into every HTTP call (schedule, confirm, cancel, reschedule, search, available slots).
- `BookingService` validates that `clinic_id` is present for schedule/search requests and refuses to operate if the appointment belongs to another clinic.
- `database.js` filters every appointment query/update by `clinic_id`, so cross-tenant lookups return zero rows.
- `tests/test-tenant-isolation.js` creates appointments for two clinics with identical patient metadata to ensure one clinic can’t read the other’s records.

---

### Step 6: Retell Agent Configuration

**Per-Clinic Retell Agents:**

**Clinic A Agent:**
- Agent ID: `agent_clinicA_123`
- Prompt: "You are Kelly, the receptionist for Clinic A..."
- Functions: Same functions, but backend routes to Clinic A
- Webhook URL: `https://doclittle.site/voice/incoming` (same for all)

**Clinic B Agent:**
- Agent ID: `agent_clinicB_456`
- Prompt: "You are Kelly, the receptionist for Clinic B..."
- Functions: Same functions, but backend routes to Clinic B
- Webhook URL: `https://doclittle.site/voice/incoming` (same for all)

**Key Point:** All agents use the SAME webhook URL, but backend identifies tenant from phone number.

---

### Step 7: Twilio Configuration

**Option A: One Twilio Account, Multiple Numbers**
- One Twilio account for DocLittle
- Each clinic gets a phone number
- All numbers point to same webhook: `/voice/incoming`
- Backend identifies tenant from `To` number

**Option B: Multiple Twilio Accounts**
- Each clinic has their own Twilio account
- More isolation, but more complex
- Not recommended unless needed

**Recommendation:** Option A (one account, multiple numbers)

---

## Complete Multi-Tenant Flow

### Example: Patient Calls Clinic A

1. **Patient calls:** `+1-555-0100` (Clinic A's number)

2. **Twilio receives call:**
   - Sends webhook to: `https://doclittle.site/voice/incoming`
   - Includes: `To: +15550100`, `From: +15551234567`

3. **Backend identifies tenant:**
   ```javascript
   const clinic = db.getClinicByPhoneNumber('+15550100');
   // Returns: { clinic_id: 'clinic-001', retell_agent_id: 'agent_clinicA_123', ... }
   ```

4. **Backend registers with Retell:**
   ```javascript
   {
     agent_id: 'agent_clinicA_123',  // Clinic A's agent
     metadata: {
       clinic_id: 'clinic-001',
       merchant_id: 'clinicA-merchant-id'
     }
   }
   ```

5. **Retell connects via WebSocket:**
   - Uses Clinic A's agent
   - Calls functions with clinic context

6. **Function calls are clinic-scoped:**
   ```javascript
   schedule_appointment() {
     // Automatically uses Clinic A's calendar
     // Stores appointment with clinic_id: 'clinic-001'
     // Checks Clinic A's availability
   }
   ```

7. **Data is isolated:**
   - Patient records: `clinic_id: 'clinic-001'`
   - Appointments: `clinic_id: 'clinic-001'`
   - Calendar: Clinic A's Google Calendar

---

## Database Schema Changes Needed

### New Tables

**1. `clinics` table:**
```sql
CREATE TABLE clinics (
  clinic_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,  -- 'clinicA', 'clinicB'
  retell_agent_id TEXT,
  merchant_id TEXT,
  google_calendar_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**2. `clinic_phone_numbers` table:**
```sql
CREATE TABLE clinic_phone_numbers (
  phone_number TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  is_active BOOLEAN DEFAULT 1,
  FOREIGN KEY (clinic_id) REFERENCES clinics(clinic_id)
);
```

### Existing Tables - Add `clinic_id`

**All existing tables need `clinic_id` column:**
- `fhir_patients` → `clinic_id`
- `appointments` → `clinic_id`
- `insurance_claims` → `clinic_id`
- `eligibility_checks` → `clinic_id`
- `users` → `clinic_id`

---

## Retell Configuration Per Clinic

### Setting Up Agents

**For each clinic:**
1. Create Retell agent in Retell dashboard
2. Configure agent with clinic-specific prompt
3. Set webhook URL: `https://doclittle.site/voice/incoming` (same for all)
4. Store agent ID in `clinics.retell_agent_id`

**Agent Prompt Example (Clinic A):**
```
You are Kelly, the receptionist for Clinic A, a mental health practice...
Our clinic specializes in...
Our hours are...
```

**Agent Prompt Example (Clinic B):**
```
You are Kelly, the receptionist for Clinic B, a pediatric clinic...
Our clinic specializes in...
Our hours are...
```

---

## Summary: What Needs to Change

### 1. Database
- ✅ Add `clinics` table
- ✅ Add `clinic_phone_numbers` table
- ✅ Add `clinic_id` to all existing tables

### 2. Webhook Handler (`/voice/incoming`)
- ✅ Look up clinic from phone number
- ✅ Use clinic's Retell agent ID
- ✅ Use clinic's merchant ID
- ✅ Pass clinic_id in metadata

### 3. Retell WebSocket Handler
- ✅ Get clinic_id from call metadata
- ✅ Scope all function calls to clinic
- ✅ Use clinic's calendar, data, etc.

### 4. All Service Functions
- ✅ Accept `clinic_id` parameter
- ✅ Filter queries by `clinic_id`
- ✅ Store data with `clinic_id`

### 5. Retell Dashboard
- ✅ Create one agent per clinic
- ✅ Configure clinic-specific prompts
- ✅ Store agent IDs in database

---

## Key Principles

1. **Phone Number = Tenant Identifier**
   - When call comes in, phone number tells us which clinic

2. **One Agent Per Clinic**
   - Each clinic has their own Retell agent
   - Allows custom prompts and behavior

3. **Data Isolation**
   - Every database query filtered by `clinic_id`
   - No cross-clinic data access

4. **Shared Infrastructure**
   - Same webhook URL for all clinics
   - Same backend code
   - Same database (with tenant isolation)

5. **Scalable**
   - Add new clinic = Add phone number + Create Retell agent
   - No code changes needed

---

## Next Steps (When Ready to Code)

1. Create database migration for `clinics` and `clinic_phone_numbers` tables
2. Add `clinic_id` columns to existing tables
3. Update `/voice/incoming` to identify tenant
4. Update Retell WebSocket handler to use clinic context
5. Update all service functions to accept `clinic_id`
6. Create Retell agents for each clinic
7. Test with multiple clinics

---

## Questions to Answer Before Coding

1. **How many clinics initially?** (affects migration strategy)
2. **Do clinics share phone numbers or separate?** (affects Twilio setup)
3. **Do clinics have different business hours?** (affects booking service)
4. **Do clinics have different appointment types?** (affects booking service)
5. **Do clinics share insurance providers?** (affects insurance service)
6. **How do we create new clinics?** (admin interface needed?)

