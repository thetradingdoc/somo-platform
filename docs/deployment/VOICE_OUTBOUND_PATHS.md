# Voice outbound paths

## Primary: Twilio-direct (recommended)

`Twilio.calls.create` → `/voice/incoming?call_type=operator_outbound&customer_id=...&agent_id=...`

Used by:
- `scripts/make-outbound-call.js`
- `routes/outbound-call.js`
- `services/outbound-call-service.js`
- Admin leads Twilio fallback

## Secondary: Retell create-phone-call

Used by `routes/admin-leads.js` when Retell SIP trunk is configured.

Requires Retell dashboard telephony permissions. If `telephony_provider_permission_denied`, use Twilio-direct.

## Retell phone API deprecation

Audit `inbound_agents` migration before **Mar 31, 2026**. Run `configure-retell.js` + `verify-agent-config.cjs` after deploy.
