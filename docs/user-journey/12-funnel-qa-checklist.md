# Funnel QA checklist (`/start`)

**Last updated:** 2026-05-21

Manual verification after funnel API or landing changes. Requires middleware on `:4000` and CRA build for `/start` (or dev server).

## Automated (API)

With server running:

```bash
cd middleware-platform && npm run test:e2e-funnel
```

## Happy paths

1. **Track program** — Photo → age → intent (track routine) → match → program preview → save (email + OTP) → done.
2. **Find specialist** — Intent (find derm) → capture → Kelly gate → US ZIP → NPPES list → save without template.
3. **Dual** — Specialist path → upsell “Track while I find a derm” → dual offer → save activates template.

## Handoff

4. **Continue on web** — After save with session, tap **Continue on web** → `patient-dashboard.html` loads; confirm `patient_portal_events` row `auth_handoff_continue_web`.
5. **Get the app** — Handoff link includes `patientapp://auth?ticket=…`; confirm `auth_handoff_app_link_shown` event when ticket returned.

## Redirects

6. **Legacy `/consumer`** → redirects to `/start` (or login for get-app/join paths).

## Portal events (SQL)

```sql
SELECT event_name, created_at, metadata_json
FROM patient_portal_events
WHERE session_id = '<portal_session_id>'
ORDER BY created_at DESC;
```

Expected funnel-related names: `auth_handoff_continue_web`, `auth_handoff_app_link_shown`, `auth_handoff_app_link_failed`, plus `auth_handoff_created` / `auth_handoff_exchanged` from routine routes.
