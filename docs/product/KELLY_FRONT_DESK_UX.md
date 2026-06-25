# Kelly Front Desk UX

**Last updated:** 2026-06-16

## Mental model

- **Kelly** = voice persona (what is spoken on calls)
- **Somo** = platform brand (UI chrome, product name)
- **Inbound** = receptionist mode (answers your line)
- **Outbound** = calling mode (Kelly calls out when enabled)

## Tenant-facing settings contract

| Setting | Purpose |
|---------|---------|
| `greeting` / `inbound_greeting` | Inbound opener only |
| `outbound_opener` | Outbound script only |
| `outbound_enabled` | Master switch for outbound dialing |
| `custom_prompt` | Advanced behavior (not the spoken opener) |
| `prompt_profile` / Retell internals | Hidden implementation detail |

## Onboarding state machine

`signup_started` → `line_assigned` → `terms_accepted` → `activation_shown` → `voice_setup_incomplete` → `voice_setup_complete` → `live`

API: `GET /api/voice-agent/onboarding` returns `onboarding_state`, `destination.path`, and blockers.

## UI surfaces

| Surface | Path | Font / brand |
|---------|------|----------------|
| Setup wizard | `voice-setup.html` (5 steps) | League Spartan, `somo-logo.png`, lizard CTA |
| Trial activation | `trial-activation.html` | Signup marketing styles |
| Agent dashboard | `agent.html` | Plus Jakarta Sans, inbound/outbound cards |

## Preview parity

`GET /api/voice-agent/preview` and `resolveCallOpeners()` in [`call-opener-resolver.js`](../../middleware-platform/services/call-opener-resolver.js) are the single source for UI preview and live call openers.

## Admin support

- `GET /api/admin/voice-onboarding/customers/:id/voice-onboarding`
- `POST /api/admin/voice-onboarding/customers/:id/reset-onboarding`
- `GET /api/admin/voice-onboarding/customers/:id/opener-compare`

## Migration

```bash
node middleware-platform/scripts/migrate-voice-onboarding-v1.cjs --dry-run
```
