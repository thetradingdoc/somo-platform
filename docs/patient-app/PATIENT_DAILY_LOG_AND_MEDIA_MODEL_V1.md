# Daily Log and Media Model — V1

**Last updated:** 2026-04-22

---

## 1. Entities

- **Daily entry** (`patient_routine_daily_entries`): one row per `(template_id, entry_date)` with `skin_report` (JSON), `notes`, `completion_score` (0–100 from item logs).  
- **Item logs** (`patient_routine_daily_item_logs`): per `daily_entry_id` + `template_item_id`, `completed`, optional `notes`.  
- **Media** (`patient_routine_daily_media`): `media_type`, `patient_document_id` and/or `media_url`, linked to `daily_entry_id`.

---

## 2. API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/patient/routine/daily?date=YYYY-MM-DD` | Resolve active template; return `daily_entry` + `item_logs` + `media` for that date. |
| POST | `/api/patient/routine/daily` | Upsert daily entry; replace item logs; recompute `completion_score`. |
| POST | `/api/patient/routine/daily/:id/media-link` | Attach uploaded document or URL to the entry. |

---

## 3. Skin report JSON

Structured object (version field + redness / oiliness / breakouts / detail). Legacy plain text is wrapped as `{ legacy_text }` for parsing.

---

## 4. UI behavior (Routine page)

- Checklists grouped by **Morning**, **Morning & evening** (single checkbox counts for the day), **Evening**, **Weekly / other** based on `usage_time`.  
- Save persists journal then refreshes GET.  
- Photo: ensure entry exists (save if needed) → `POST /api/patient/documents` → media-link per returned document id.

---

## 5. Analytics (server)

On successful POST daily: `daily_log_saved`; if `completion_score >= 100`, also `routine_completed_day`.  
On successful media-link: `picture_of_day_linked`.  
See `patient_portal_events` in `BACKEND_ROUTES_AND_TABLES_PATIENT_PORTAL.md`.
