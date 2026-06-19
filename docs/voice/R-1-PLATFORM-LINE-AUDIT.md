# R-1: Platform line `+13639990205` audit

**Date:** 2026-06-18  
**Epic:** PLATFORM-VOICE

## Twilio ingress

- **Handler:** `middleware-platform/services/voice-incoming-handler.js` → `POST /voice/incoming`
- **Demo detect:** `isDemoTwilioNumber(normalizedTo)` OR `call_type=somo_demo` query param
- **Register payload:** `metadata.call_type`, `retell_llm_dynamic_variables.call_type`, `customer_id`, `clinic_id`, `direction`

## Retell WebSocket

- **Handler:** `middleware-platform/webhooks/retell-websocket.js`
- **World resolve:** `voice-routing-world.resolveRoutingWorld()` on `call_details`
- **Kelly block:** `shouldBlockKellyTurn` for `demo` / `unidentified`
- **Backfill (R-3):** `dynamic_variables` → `customer_id`, `clinic_id`, `call_type`, `direction`, `to_number`, `from_number`

## Known shared-number config

`+13639990205` may equal:

- `TWILIO_PHONE_NUMBER`
- `CALLSOMO_OPERATOR_TWILIO_NUMBER`
- Demo fallback in `somo-demo-template-registry`

**R-7:** Set `SOMO_DEMO_TWILIO_FROM_NUMBER` ≠ operator number in prod to split roles.

## Failure mode (fixed)

Lost `call_type` metadata → Kelly tenant clinical on platform line. **Fix:** R-4 `to_number` demo gate + R-5b `customer_id`-only tenant resolve.
