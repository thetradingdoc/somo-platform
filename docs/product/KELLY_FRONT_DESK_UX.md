# Kelly Front Desk UX

**Last updated:** 2026-07-05

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

### Self-serve (live)

`signup.html` → email verify → `voice-setup.html` (7 steps) → `trial-activation.html` / `today.html` → `live`

States: `signup_started` → `line_assigned` → `terms_accepted` → `voice_setup_incomplete` → `voice_setup_complete` → `live`

API: `POST /api/signup/assign-line` binds Twilio DID + Retell agent after wizard completion.

### Operator-invite (alternate path)

Admin pipeline → **Send pilot invite** → `invite.html` → `voice-setup.html` → `agent.html` / `today.html`

Active when `PILOT_INVITE_ONLY=1`; otherwise self-serve is the default onboarding path.

API: `GET /api/voice-agent/onboarding` returns `onboarding_state`, `destination.path`, and blockers.

Docs: [`phase4-pilot-checklist.md`](../voice-agent/phase4-pilot-checklist.md)

## UI surfaces

| Surface | Path | Notes |
|---------|------|-------|
| Signup | `signup.html` | Self-serve tenant provisioning (persona + practice details) |
| Invite accept | `invite.html` | Operator-invite when `PILOT_INVITE_ONLY=1` |
| Setup wizard | `voice-setup.html` (7 steps) | Greeting, hours, languages, transfer #, NPI, coverage |
| Agent dashboard | `agent.html` | Greeting, overflow, porting, kill switch, latency KPI |
| Today | `today.html` | Go-live checklist, ROI panel, voice activity |
| Trial activation | `trial-activation.html` | Post-signup activation; gates "Call my line" on Kelly ready |

## Retired consumer surfaces (Gate G4, 2026-07)

The legacy **Skin & Care patient portal** (`unified-dashboard/patients/*`) is **retired** from Firebase hosting. Bookmarks to `/patients/*` redirect to the Somo marketing landing (`/`). Provider-facing Kelly remains the active product surface. A future direct-to-patient product would be a separately scoped build — not a resurrection of these pages.

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
