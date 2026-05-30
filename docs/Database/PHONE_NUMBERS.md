# Phone number fields

> **Last reviewed:** 2026-05-29  
> **ADR:** [VOICE_PHONE_SEMANTICS.md](../architecture/VOICE_PHONE_SEMANTICS.md)

## Four meanings in the schema

| Field / table | Meaning | Example use |
|---------------|---------|-------------|
| `customers.phone_number` | **Contact** — account recovery, OTP, trial verify | Owner mobile for SMS |
| `customers.phone_verified` | Contact verified (trial gate) | Must be `1` before `trial_status=active` (W2-09) |
| `customers.twilio_phone_number` | **Inbound voice line** (Twilio DID) | Callers dial this; webhook routes to tenant |
| `customers.twilio_phone_sid` | Twilio `IncomingPhoneNumbers` SID | Webhook updates via API |
| `clinics.phone_number` | Clinic record display / legacy | May differ from SaaS inbound line |
| `clinic_phone_numbers` | Routing map clinic ↔ E.164 | Multiple lines per clinic; often empty until provision |

## Contact vs inbound (owner setup)

For Somo owner dev:

- **Inbound:** `+18622307479` → `twilio_phone_number` + SID (D3-03 attach script)
- **Contact:** If owner texts OTP to a different mobile, set `phone_number` and `phone_verified=1` separately (D3-04)

Document both in your Week 1 handoff when they differ.

## Twilio webhook shape

```text
POST {PUBLIC_URL}/voice/incoming?customer_id={OWNER_CUSTOMER_ID}
```

`customer_id` in the query string binds the call to the SaaS tenant when the DID is shared or routing is explicit.

## Provisioning paths

| Path | Writes |
|------|--------|
| Trial SIM signup | Twilio purchase + `customers` + optional `clinic_phone_numbers` |
| `attach-existing-twilio-number.cjs` | Existing DID → `customers` + webhook + `clinic_phone_numbers` |
| `create-web-provider-account.js` | New tenant; may set clinic phone only |

## Related

- [SOMO_FOUNDATION_RUNBOOK.md](./SOMO_FOUNDATION_RUNBOOK.md) — Day 3 Twilio bind
- [voice-inbound-troubleshooting.md](../runbooks/voice-inbound-troubleshooting.md)
