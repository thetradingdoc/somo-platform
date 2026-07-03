# Google OAuth — onboarding engineering (FD-093–095)

## Scopes audit (FD-093)

`server.js` `/auth/google/calendar/connect` requests **calendar-only** scopes:

```
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/userinfo.email
```

No Gmail, Drive, or broad `userinfo.profile` scope. `include_granted_scopes: true` with `prompt: consent` and `access_type: offline` for refresh tokens.

Callback: `/auth/google/calendar/callback` → persists tokens on user row → redirects to `returnUrl` with `?calendar=connected` or `?calendarError=`.

Calendar list for picker: `GET /api/calendar/calendars?email=` (FD-295).

## Redirect URLs (FD-094)

| Environment | Connect entry | Callback (server) | Default return if omitted |
|-------------|---------------|-------------------|---------------------------|
| Local dev | `http://127.0.0.1:4000/auth/google/calendar/connect` | `http://127.0.0.1:4000/auth/google/calendar/callback` | Referer or `CALENDAR_RETURN_URL` |
| Staging | `https://<staging-api>/auth/google/calendar/connect` | Same host `/auth/google/calendar/callback` | `CALENDAR_RETURN_URL` env |
| Production | `https://api.callsomo.com/auth/google/calendar/connect` | `https://api.callsomo.com/auth/google/calendar/callback` | `https://callsomo.com/business/settings.html` |

Voice-setup passes explicit return:

```
/business/voice-setup.html?step=2&calendar=connected
```

Configure the callback URL in Google Cloud Console **Authorized redirect URIs** for each environment.

Env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `API_BASE_URL` or `BASE_URL`, optional `CALENDAR_RETURN_URL`.

## Ops consent screen copy (FD-095)

Suggested Google OAuth consent screen text for Somo Front Desk:

**App name:** Somo Front Desk  
**User support email:** support@callsomo.com  

**Scopes justification:**

- **Google Calendar** — Somo Kelly reads your calendar availability and creates appointment events when patients book by phone. We do not read email or other Google data.
- **Email address** — Used to match the connected Google account to your Somo practice login.

**Privacy policy / Terms:** Link to `https://callsomo.com/health-privacy` and Terms of Service.

**Internal note:** Pilot offices should connect the **scheduling** calendar Kelly will write to; the onboarding picker (`setupCalendarPick`) saves selection via existing calendar settings API.
