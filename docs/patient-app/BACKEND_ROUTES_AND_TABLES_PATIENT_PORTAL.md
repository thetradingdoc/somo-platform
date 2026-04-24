# Backend routes and tables — Patient portal & journal (V1)

**Last updated:** 2026-04-22  
**Implementation:** `middleware-platform/server.js`, `middleware-platform/routes/signup.js`, `middleware-platform/services/landing-session-claim-service.js`

---

## 1. Patient session

Most routes below use **`requirePatientSession`** and `x-session-id` (or equivalent session cookie, depending on client).

---

## 2. Routine & home

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/patient/routine/template` | Active template + template items + shelf products. |
| POST | `/api/patient/routine/template` | Creates new active template; deactivates previous. |
| GET | `/api/patient/routine/daily?date=` | Daily entry + item logs + media for date. |
| POST | `/api/patient/routine/daily` | Upsert daily entry and logs. |
| POST | `/api/patient/routine/daily/:id/media-link` | Link document or URL to daily entry. |
| GET | `/api/patient/home/progress-summary` | Home board metrics and cards. |
| GET | `/api/patient/shelf/products` | Shelf rows for routine wizard / Products UI. |
| PATCH | `/api/patient/shelf/products/:productId` | Update inventory fields. |
| POST | `/api/patient/analytics/event` | Whitelist: `home_summary_viewed` (client); other events server-emitted. |
| GET | `/api/patient/health/catalog` | Whether `products_catalog` / OBF / OFF tables exist. |

**Tables (SQLite):** `patient_routine_templates`, `patient_routine_template_items`, `patient_routine_daily_entries`, `patient_routine_daily_item_logs`, `patient_routine_daily_media`, `patient_onboarding_step3_products` (shelf), `patient_portal_events` (analytics).

`ensureRoutineTables()` and `ensurePatientPortalEventsTable()` create/alter routine + event tables as needed.

---

## 3. Customer landing claim & shelf

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/customer/landing/claim-session` | **`requireCustomerAuth`** (`customer_session` cookie). Body: `{ "landing_session_id": "<sid>" }`. |
| GET | `/api/customer/products` | Same — lists claimed `customer_products`. |

**Tables:** `customer_products`, `claim_audit` (see `landing-session-claim-service.js` DDL).

---

## 4. Tests

- `middleware-platform/__tests__/landing-session-claim-service.test.js` — claim idempotency, foreign customer, **claim → listCustomerProducts**.  
- `middleware-platform/__tests__/claim-session-http.test.js` — **401** without `customer_session` on `POST /api/customer/landing/claim-session`.

---

## 5. Related docs

- `PATIENT_JOURNAL_REDESIGN_V1.md`  
- `PATIENT_APP_ARCHITECTURE_AND_AGENT_ORCHESTRATION.md`
