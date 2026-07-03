# `onboarding_meta_json` UI sync contract (FD-035)

Customer row field: `onboarding_meta_json` (JSON object). Parsed by `voice-onboarding-state.parseMeta()` and returned as `onboarding_meta` on `GET /api/voice-agent/onboarding`.

## Keys written by UI

| Key | Writer | When | Consumed by |
|-----|--------|------|-------------|
| `wizard_step` | `POST /onboarding/wizard-started`, connect route | Step advance / resume | Login redirect, `destination.path` |
| `calendar_connection` | `POST /onboarding/connect` | Google / Somo / skip on Connect step | Blockers checklist item "calendar" |
| `skip_calendar_warning_ack` | `POST /onboarding/connect` | Skip modal confirm | Unblocks calendar checklist without Google |
| `forward_line_ack` | `POST /onboarding/connect` | Step 6 checkbox | Checklist "forward line" item |
| `pms_selection` | `POST /onboarding/connect` | Optional PMS pick on Connect | Admin tenant detail (future) |
| `{state}_at` | `transitionState()` | Each state transition | Audit / ops debugging |

## API surfaces

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/voice-agent/onboarding` | GET | `onboarding_state`, `destination` (path, blockers, checklist), `onboarding_meta` |
| `/api/voice-agent/onboarding/connect` | POST | Patch meta keys above |
| `/api/voice-agent/onboarding/wizard-started` | POST | Set `wizard_step` + log start |
| `/api/voice-agent/onboarding/status` | POST | Mark `voice_setup_complete` or `live` |

## Frontend modules

- `unified-dashboard/assets/js/onboarding-api.js` — shared client (`fetchOnboarding`, `patchConnectMeta`, `startWizardStep`)
- `unified-dashboard/assets/js/onboarding-redirect.js` — post-login destination from `destination.path` + blockers hash
- `unified-dashboard/assets/js/voice-setup.js` — persists connect + forward ack; no `sessionStorage` for calendar choice
- `unified-dashboard/business/today.html` — renders `destination.checklist` from API (fallback to legacy heuristic if empty)

## Checklist contract

`onboarding-blockers-service.resolveOnboardingBlockers()` returns `checklist[]` items:

```json
{ "id": "forward-line", "label": "…", "done": false, "href": "/business/settings.html#profile", "severity": "blocker" }
```

`today.html` maps `severity === 'info'` to warn styling. Celebration when every item has `done: true` and URL hash is `#go-live-checklist`.

## Do not store in meta

- Passwords, OAuth tokens, or calendar IDs (those live on `users` / voice settings tables).
- Ephemeral UI-only state (use component state instead).
