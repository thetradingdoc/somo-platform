# Voice Agent: Functions & Dynamic Variables

Single reference for the Retell voice agent: all tool functions and dynamic variables (for dashboard audio/LLM tests). Source: `server.js` (where variables are set), `webhooks/retell-websocket.js` (where they are read and where functions are handled).

---

## 1. Voice agent functions

These are the tool names the LLM can call. Handled in `webhooks/retell-websocket.js`:

| Function name | Purpose |
|---------------|--------|
| `collect_insurance` | Collect insurance info (member id, payer, etc.) |
| `schedule_appointment` | Book an appointment (patient, date, time, type) |
| `get_available_slots` | Get available time slots |
| `search_appointments` | Search existing appointments |
| `confirm_appointment` | Confirm an appointment |
| `cancel_appointment` | Cancel an appointment |
| `reschedule_appointment` | Reschedule an appointment |
| `create_appointment_checkout` | Create checkout for appointment (e.g. copay) |
| `verify_checkout_code` | Verify checkout verification code |
| `verify_email_code` / `verify_email_verification_code` | Verify email code (e.g. for checkout) |
| `schedule_demo` | Schedule a sales demo (outbound) |
| `collect_contact_info` | Collect contact info (outbound) |
| `end_call` | End the call (outbound) |
| `get_patient_claims` | Get patient claims/benefits (after insurance collected) |
| `get_order_tracking` | Get order tracking (uses `merchant_id`) |
| `send_followup_email` | Send follow-up email (outbound) |
| `send_followup_sms` | Send follow-up SMS (outbound) |
| `search_products` | Search products (uses `merchant_id`) |
| `create_checkout` | Create voice checkout / payment link (uses `merchant_id`) |
| `search_icd10_codes` | Search ICD-10 codes |
| `search_cpt_codes` | Search CPT codes |
| `search_hcpcs_codes` | Search HCPCS codes |
| `extract_medical_text` | Extract medical text from conversation |
| `assess_urgency` | Assess urgency/triage |
| `suggest_codes_from_symptoms` | Suggest codes from symptoms |
| `validate_code_pair` | Validate ICD/CPT pair |
| `check_payer_guidelines` | Check payer guidelines |
| `get_code_pricing` | Get code pricing |

---

## 2. Dynamic variables

Set when the call is registered (`server.js`: `retell_llm_dynamic_variables`). Read from `message.call.dynamic_variables` or `message.call.retell_llm_dynamic_variables` in the WebSocket handler. Use these in Retell dashboard **Default Dynamic Variables** for audio/LLM tests.

### Variable name → test value (and where used)

| Variable name   | Test value example | Used by |
|-----------------|--------------------|--------|
| `merchant_id`   | `1`                | `search_products`, `create_checkout`, `get_order_tracking`. Must exist in `merchants` table. |
| `clinic_id`     | `1`                | Tenant/credits, scheduling, state; fallback for resolving `merchant_id`. |
| `customer_id`   | `1`                | Legacy; treated as `clinic_id` when `clinic_id` is missing. |
| `patient_id`    | `patient-853a9c6d-d7b2-4901-88cb-853a36d11ac0` | Patient context (inbound when caller is recognized). |
| `patient_name`  | `Bala Jones`       | Patient context. |
| `has_insurance` | `yes` or `no`      | Context only (copay/eligibility done via tools). |
| `customer_type` | `clinic`           | Optional context. |
| `clinic_name`   | `DocLittle Mental Health Team` | Outbound sales context. |
| `clinic_location`| `America/New_York` | Outbound sales context. |
| `job_title`     | `Medical Receptionist` | Outbound sales context. |
| `lead_id`       | `1`                | Outbound: `schedule_demo`, `collect_contact_info`, `end_call`, `send_followup_email`, `send_followup_sms`. |
| `lead_source`   | `job_search`       | Outbound sales context. |

### Minimum for dashboard tests

- **Variable name:** `merchant_id` → **Test value:** your real merchant id (e.g. `1`).
- **Variable name:** `clinic_id` → **Test value:** your real clinic id (e.g. `1`).

Add others as needed for patient or outbound tests. All values are sent as strings.

---

## 3. Testing telemedicine booking + financial (copay)

To test with a **test patient account** and run the full flow (book telemedicine appointment → calendar → copay/financial), the agent needs the right context. Use Retell **Default Dynamic Variables** (or pass the same keys when registering a call).

### What each piece does

| Need | How it's provided | Purpose |
|------|-------------------|--------|
| **Calendar** | `clinic_id` | Which clinic’s calendar and slots are used. `get_available_slots` and `schedule_appointment` both use `clinic_id`. |
| **Patient name** | `patient_name` | Who is “calling.” Lets the agent say the right name and pass it into `schedule_appointment` and `create_appointment_checkout` (e.g. `customer_name`). |
| **Copay / financial** | `merchant_id` + `clinic_id` | `create_appointment_checkout` needs `clinic_id` (and resolves `merchant_id` from clinic if not set). Amount can come from eligibility when the appointment is linked to a patient. |
| **Clinic** | `clinic_id` (required), `clinic_name` (optional) | `clinic_id` is required for slots/schedule/checkout. `clinic_name` is for the agent’s wording (e.g. “booking at {{clinic_name}}”). |

### Recommended dynamic variables for “test patient + telemedicine + copay”

Set these in Retell (Variable name → Test value). Use your real DB values for IDs.

| Variable name   | Test value (example) | Required? | Notes |
|-----------------|------------------------|-----------|--------|
| `clinic_id`     | `clinic-default`       | **Yes**   | Drives calendar and slots; required for schedule and checkout. |
| `merchant_id`   | `merchant_c3d547a10f43eeec` | **Yes**   | Required for creating checkout (copay). Server can resolve from `clinic_id` if clinic has `merchant_id`. |
| `patient_name`  | `Jane Test`            | **Recommended** | Test patient’s name so the agent knows the caller and can use it in booking/checkout. |
| `patient_id`    | FHIR `resource_id` of test patient | Optional | For context only; backend links appointment to patient via name+phone+email from the conversation. |
| `clinic_name`   | `DocLittle Mental Health` | Optional | So the agent can say the correct clinic name. |
| `has_insurance` | `yes` or `no`          | Optional | Informs whether to mention copay/eligibility. |

### Flow and test data

1. **Slots & schedule**  
   Agent calls `get_available_slots` and `schedule_appointment` using `clinic_id` from dynamic variables. When testing from the dashboard (no real phone), have the agent collect (or you provide in the test) the **test patient’s real name, phone, and email** so that:
   - `BookingService` can run `getOrCreatePatient` and link the appointment to the correct FHIR patient.
   - The appointment appears under that patient and that clinic’s calendar.

2. **Checkout / copay**  
   After scheduling, the agent calls `create_appointment_checkout` with `appointment_id` from the schedule result (or the backend finds the most recent appointment by customer phone/email). If the appointment has a `patient_id`, the server can compute amount from eligibility/copay when available.

3. **Inbound calls**  
   For real inbound calls, the server pre-fills `patient_id`, `patient_name`, and `has_insurance` from the caller’s phone (FHIR lookup). For **dashboard/LLM tests** there is no caller phone, so set `patient_name` (and optionally `patient_id`, `clinic_name`, `has_insurance`) in Retell so the agent has the right context.

---

## 4. Related docs

- [RETELL_CONFIG_QUICK_REFERENCE.md](./RETELL_CONFIG_QUICK_REFERENCE.md) — Retell URLs, ngrok, Twilio.
- [LANGGRAPH_LANGSMITH.md](./LANGGRAPH_LANGSMITH.md) — Tracing and voice coding graph.
