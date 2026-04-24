# Patient Journal Redesign — V1

**Last updated:** 2026-04-22  
**Scope:** Unified web patient portal (`unified-dashboard/patients/*`) journal: template → daily log → media → home summary.  
**Out of scope for V1:** Rebuilding telemedicine, OAuth/password auth, wallet-first home.

---

## 1. Product intent

V1 delivers a **skincare routine journal** that is separate from **telehealth booking**:

| Surface | Role |
|--------|------|
| **Routine** (`appointments.html`) | Create/edit routine template; daily AM/PM checklist; skin report + notes; picture-of-the-day. |
| **Home** (`patient-dashboard.html`) | Routine-first board: progress summary, cards, conditional scan FAB. |
| **Calendar** (`schedule.html`) | Book visits; see visit vs routine-day markers; conflict hints — not the daily journal. |
| **Products** (`my-records.html`) | Shelf inventory, visit summaries, documents. |

Information architecture: **Home / Calendar / Products / Routine / More** (tabs + side nav aligned).

---

## 2. User journeys

1. **Onboarding** completes Step 3 product baseline (catalog-first + custom fallback).  
2. **Routine:** Guided wizard (name → products → AM/PM → duration → review) saves `POST /api/patient/routine/template`.  
3. **Daily log:** Date picker, checklists by usage bucket, skin fields, notes, `POST /api/patient/routine/daily`.  
4. **Picture:** Upload document → `POST /api/patient/routine/daily/:id/media-link`.  
5. **Home:** `GET /api/patient/home/progress-summary` drives stats and cards; optional `POST /api/patient/analytics/event` with `home_summary_viewed`.  
6. **Landing → customer shelf:** After customer OTP/session, `POST /api/customer/landing/claim-session` with `landing_session_id`; shelf read via `GET /api/customer/products`.

---

## 3. Non-goals (V1)

- Replacing FHIR encounter reads for appointments.  
- Symptom/condition tracker categories (future).  
- Push reminders (future).

---

## 4. References

- `PATIENT_ROUTINE_TEMPLATE_FLOW_V1.md`  
- `PATIENT_DAILY_LOG_AND_MEDIA_MODEL_V1.md`  
- `PATIENT_HOME_SUMMARY_METRICS_V1.md`  
- `BACKEND_ROUTES_AND_TABLES_PATIENT_PORTAL.md`  
- `PATIENT_APP_ARCHITECTURE_AND_AGENT_ORCHESTRATION.md` (mobile + agents)
