# Routine Template Flow — V1

**Last updated:** 2026-04-22  
**UI:** `unified-dashboard/patients/appointments.html` (Routine page)

---

## 1. Data model

- **Template** (`patient_routine_templates`): `name`, `start_date`, `duration_days`, `repeat_cadence` (`daily` | `selected_days`), `repeat_days_of_week_json`, `session_id`, `patient_id`, `is_active`.  
- **Items** (`patient_routine_template_items`): `product_name`, `product_brand`, `usage_time`, `frequency_rule`, `days_of_week_json`, `goal`, `step_order`, linkage to shelf/onboarding products via `source_type` / `source_ref_id`.

---

## 2. API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/patient/routine/template` | Active template + shelf products for picker. |
| POST | `/api/patient/routine/template` | Deactivates prior template; inserts new template + items. |

Validation highlights: at least one item; `start_date` ISO; if `selected_days`, at least one weekday in `repeat_days_of_week`.

---

## 3. UX flow (wizard)

1. **Name** — default “My routine”.  
2. **Products** — multi-select from shelf rows (initials/color badges).  
3. **AM / PM** — maps to `usage_time` on items.  
4. **Duration** — `duration_days` + `start_date`.  
5. **Repeat** — daily or selected weekdays (`repeat_cadence` + `repeat_days_of_week`).  
6. **Review** — POST payload; success toast; scroll to daily journal.

---

## 4. Cadence semantics

- **Daily:** every in-window calendar day is a routine day (used for Calendar purple dots).  
- **Selected days:** only matching weekday keys (`mon` … `sun`) inside `[start_date, start_date + duration_days - 1]`.

---

## 5. Related

- Daily persistence: `PATIENT_DAILY_LOG_AND_MEDIA_MODEL_V1.md`  
- Home metrics: `PATIENT_HOME_SUMMARY_METRICS_V1.md`
