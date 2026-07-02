# Kelly Front Desk UX

**Last updated:** 2026-07-02

## Mental model

- **Kelly** = voice persona (what is spoken on calls)
- **Somo** = platform brand (UI chrome, product name)
- **Inbound** = receptionist mode (answers your line)
- **Outbound** = calling mode (Kelly calls out when enabled)

## Tenant-facing settings contract

| Setting | Purpose |
|---------|---------|
| `greeting` / `inbound_greeting` | Inbound opener only (name-first via `call-opener-resolver.js`) |
| `outbound_opener` | Outbound script only |
| `outbound_enabled` | Master switch for outbound dialing |
| `overflow_phone` / `overflow_enabled` | Forward on credits-exhausted or concurrent busy |
| `transfer_number` | Warm transfer / kill-switch PSTN forward |
| `custom_prompt` | Advanced behavior (not the spoken opener) |
| `prompt_profile` / Retell internals | Hidden implementation detail |

## Onboarding state machines

### Self-serve (deferred during pilot)

`signup_started` → `line_assigned` → `terms_accepted` → `activation_shown` → `voice_setup_incomplete` → `voice_setup_complete` → `live`

### Operator-invite pilot (active)

Admin pipeline → **Send pilot invite** → `invite.html` → `voice-setup.html` → `agent.html` / `today.html`

API: `GET /api/voice-agent/onboarding` returns `onboarding_state`, `destination.path`, and blockers.

Docs: [`phase4-pilot-checklist.md`](../voice-agent/phase4-pilot-checklist.md)

## UI surfaces

| Surface | Path | Notes |
|---------|------|-------|
| Invite accept | `invite.html` | Operator-invite only when `PILOT_INVITE_ONLY=1` |
| Setup wizard | `voice-setup.html` (5 steps) | Dental fields, transfer #, NPI, coverage hours |
| Agent dashboard | `agent.html` | Greeting, overflow, porting, kill switch, latency KPI |
| Today | `today.html` | Go-live checklist, ROI panel, voice activity |
| Trial activation | `trial-activation.html` | Signup marketing (blocked during pilot) |

## Preview parity

`GET /api/voice-agent/preview` and `resolveCallOpeners()` in [`call-opener-resolver.js`](../../middleware-platform/services/call-opener-resolver.js) are the single source for UI preview and live call openers.

## Admin support

- `GET /api/admin/voice-onboarding/customers/:id/voice-onboarding`
- `POST /api/admin/voice-onboarding/customers/:id/reset-onboarding`
- `GET /api/admin/voice-onboarding/customers/:id/opener-compare`
- Pipeline → send invite: `routes/provider-invites.js`

## Migration

```bash
node middleware-platform/scripts/migrate-voice-onboarding-v1.cjs --dry-run
```
