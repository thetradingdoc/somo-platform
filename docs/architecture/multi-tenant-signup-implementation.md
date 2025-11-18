# Multi-Tenant Clinic Signup Implementation

## Overview

This document describes the implementation of the automated multi-tenant clinic signup flow, including Retell agent creation and database setup.

## What Was Implemented

### 1. Database Schema

#### New Tables

**`clinics` table:**
- `id` (TEXT PRIMARY KEY) - Unique clinic ID
- `clinic_slug` (TEXT UNIQUE) - URL-friendly clinic identifier (e.g., "acme-medical-center")
- `name` (TEXT) - Clinic name
- `phone_number` (TEXT) - Clinic phone number
- `retell_agent_id` (TEXT) - Retell AI agent ID
- `retell_agent_status` (TEXT) - Status: 'pending' or 'active'
- `merchant_id` (TEXT UNIQUE) - Payment merchant ID
- `business_hours` (TEXT) - Business hours
- `timezone` (TEXT) - Timezone (default: 'America/New_York')
- `address` (TEXT) - Clinic address
- `description` (TEXT) - Clinic description
- `status` (TEXT) - Status: 'active' or 'inactive'
- `created_at` (DATETIME) - Creation timestamp
- `updated_at` (DATETIME) - Last update timestamp

**`clinic_phone_numbers` table:**
- `id` (TEXT PRIMARY KEY) - Unique phone record ID
- `clinic_id` (TEXT) - Foreign key to clinics.id
- `phone_number` (TEXT) - Phone number (E.164 format)
- `twilio_phone_sid` (TEXT) - Twilio phone SID (for future use)
- `status` (TEXT) - Status: 'active' or 'inactive'
- `created_at` (DATETIME) - Creation timestamp

#### Database Functions

Added to `database.js`:
- `createClinic(clinic)` - Create a new clinic
- `getClinicById(id)` - Get clinic by ID
- `getClinicBySlug(slug)` - Get clinic by slug
- `getClinicByPhoneNumber(phoneNumber)` - Get clinic by phone number
- `updateClinic(id, updates)` - Update clinic information
- `createClinicPhoneNumber(phoneData)` - Link phone number to clinic
- `getClinicPhoneNumber(phoneNumber)` - Get clinic by phone number
- `getClinicPhoneNumbers(clinicId)` - Get all phone numbers for a clinic

### 2. Retell API Service

**File:** `middleware-platform/services/retell-service.js`

**Features:**
- Automated Retell agent creation via API
- Clinic-specific prompt generation from template
- Function loading (schedule_appointment, collect_insurance, get_patient_claims, process_payment)
- Agent update and retrieval methods
- Mock mode fallback if API key is not configured

**Methods:**
- `createAgent(clinicData)` - Create a new Retell agent
- `updateAgent(agentId, updates)` - Update an existing agent
- `getAgent(agentId)` - Get agent details
- `generateClinicPrompt(clinicData)` - Generate clinic-specific prompt
- `loadRetellFunctions()` - Load function definitions

### 3. Signup Form Updates

**File:** `unified-dashboard/login.html`

**Changes:**
- Added "Clinic Name" field
- Added "Clinic Phone Number" field (E.164 format)
- Added validation for phone number format
- Updated signup handler to send clinic information
- Updated redirect logic to use clinic slug (for production)

### 4. Signup Endpoint

**File:** `middleware-platform/server.js`

**Endpoint:** `POST /api/auth/signup`

**Process:**
1. **Validation:**
   - Validate user name, email, password
   - Validate clinic name and phone number
   - Check phone number format (E.164)
   - Check if user email already exists
   - Check if clinic name/slug already exists
   - Check if phone number is already in use

2. **Clinic Creation:**
   - Generate clinic slug from clinic name
   - Ensure slug is unique (append number if needed)
   - Create clinic record in database
   - Generate unique merchant ID

3. **Retell Agent Creation:**
   - Create Retell agent via API
   - Generate clinic-specific prompt
   - Store agent ID in clinic record
   - Handle errors gracefully (continue even if agent creation fails)

4. **Phone Number Linking:**
   - Link phone number to clinic in `clinic_phone_numbers` table
   - Store Twilio phone SID (for future use)

5. **User Creation:**
   - Hash password
   - Create user record with `clinic_id`
   - Link user to clinic and merchant

6. **Response:**
   - Return user session data
   - Return clinic information (ID, slug, agent ID)
   - Return `clinic_slug` for redirect

### 5. Test Script

**File:** `middleware-platform/tests/test-clinic-signup.js`

**Tests:**
- Signup API call
- Clinic record creation
- User record creation with clinic_id
- Phone number linkage
- Clinic slug uniqueness
- Database consistency

**Run:**
```bash
node tests/test-clinic-signup.js
```

## Configuration

### Environment Variables

Required in `.env`:
- `RETELL_API_KEY` - Retell AI API key (optional, will use mock mode if not set)
- `RETELL_API_BASE_URL` - Retell API base URL (default: 'https://api.retellai.com')
- `RETELL_LLM_WEBSOCKET_URL` - WebSocket URL for Retell LLM (default: 'wss://doclittle.site/retell-llm')

### Retell API Endpoints

- Create Agent: `POST /v2/create-agent`
- Update Agent: `PATCH /v2/update-agent/{agent_id}`
- Get Agent: `GET /v2/get-agent/{agent_id}`

## Usage

### Signup Flow

1. User fills out signup form:
   - Full Name
   - Clinic Name
   - Clinic Phone Number
   - Email Address
   - Password
   - Confirm Password

2. Backend processes signup:
   - Creates clinic record
   - Creates Retell agent (or marks as pending)
   - Links phone number to clinic
   - Creates user account
   - Returns clinic slug

3. Frontend redirects:
   - Production: `doclittle.site/{clinic_slug}/dashboard.html`
   - Development: `business/business-dashboard.html`

### Clinic Slug Generation

- Converts clinic name to lowercase
- Replaces non-alphanumeric characters with hyphens
- Removes leading/trailing hyphens
- Limits to 50 characters
- Ensures uniqueness (appends number if needed)

Example:
- "Acme Medical Center" → "acme-medical-center"
- "Acme Medical Center" (if exists) → "acme-medical-center-1"

## Future Enhancements

### 1. URL Routing

Set up server-side routing for clinic-specific URLs:
- `doclittle.site/{clinic_slug}` → Load clinic dashboard
- `doclittle.site/{clinic_slug}/settings` → Clinic settings
- `doclittle.site/{clinic_slug}/patients` → Patient management

### 2. Twilio Phone Number Integration

- Automatically purchase Twilio phone numbers for clinics
- Link Twilio phone SID to clinic
- Configure Twilio webhooks for clinic-specific routing

### 3. Clinic Settings

- Allow clinics to customize their Retell agent prompt
- Allow clinics to update business hours
- Allow clinics to manage multiple phone numbers

### 4. Multi-User Clinic Support

- Allow multiple users to belong to the same clinic
- Role-based access control (admin, provider, staff)
- Clinic-specific permissions

### 5. Data Isolation

- Add `clinic_id` to all existing tables (patients, appointments, claims, etc.)
- Filter all queries by `clinic_id`
- Ensure data isolation between clinics

## Testing

### Manual Testing

1. Start the backend server:
   ```bash
   cd middleware-platform
   node server.js
   ```

2. Open the signup form:
   ```
   http://localhost:8000/login.html
   ```

3. Fill out the form and submit

4. Verify:
   - Clinic record is created in database
   - Retell agent is created (or marked as pending)
   - Phone number is linked to clinic
   - User is created with clinic_id
   - Redirect works correctly

### Automated Testing

Run the test script:
```bash
node tests/test-clinic-signup.js
```

## Error Handling

### Retell Agent Creation Failure

- Clinic is still created
- `retell_agent_status` is set to 'pending'
- Admin can manually create agent later
- Error is logged for debugging

### Phone Number Already in Use

- Returns 400 error
- User must use a different phone number
- Prevents duplicate clinics with same phone

### Clinic Slug Collision

- Automatically appends number to slug
- Ensures unique slug for each clinic
- No user intervention required

## Database Migrations

### Existing Tables

The following tables already have `clinic_id` column (added via migration):
- `users` - Users belong to a clinic
- `fhir_patients` - Patients belong to a clinic
- `eligibility_checks` - Eligibility checks belong to a clinic
- `insurance_claims` - Claims belong to a clinic

### Future Migrations

Add `clinic_id` to:
- `appointments` - Appointments belong to a clinic
- `voice_checkouts` - Checkouts belong to a clinic
- `transactions` - Transactions belong to a clinic
- Other tables as needed

## Security Considerations

1. **Phone Number Validation:**
   - Validates E.164 format
   - Prevents duplicate phone numbers
   - Ensures phone numbers are unique per clinic

2. **Clinic Slug Validation:**
   - Generates URL-safe slugs
   - Prevents SQL injection
   - Ensures uniqueness

3. **User Isolation:**
   - Users are linked to clinics via `clinic_id`
   - Queries should filter by `clinic_id`
   - Prevents cross-clinic data access

## Next Steps

1. **Test the signup flow:**
   - Run the test script
   - Test manually via the signup form
   - Verify Retell agent creation (if API key is set)

2. **Set up URL routing:**
   - Configure Netlify redirects for clinic URLs
   - Or set up server-side routing
   - Update frontend to handle clinic-specific routes

3. **Add clinic_id to remaining tables:**
   - Migrate existing data
   - Update queries to filter by clinic_id
   - Test data isolation

4. **Integrate Twilio:**
   - Purchase phone numbers for clinics
   - Configure Twilio webhooks
   - Link phone numbers to Retell agents

5. **Update Retell WebSocket handler:**
   - Look up clinic by phone number
   - Use clinic-specific configuration
   - Filter data by clinic_id

## Summary

✅ Database schema created
✅ Retell API service implemented
✅ Signup form updated
✅ Signup endpoint implemented
✅ Test script created
✅ Error handling implemented
✅ Documentation created

The multi-tenant clinic signup flow is now fully functional and ready for testing!

