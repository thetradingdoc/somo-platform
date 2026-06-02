# Archived: Voice checkout email bugs (fixed)

**Archived:** 2026-06-02  
**Status:** Resolved in code; kept for incident archaeology only.

## Summary

Three voice-checkout issues were fixed in early 2026:

1. **Repeated email prompts** — `shop-voice-agent-prompt.md` + `retell-websocket.js` connection `customerEmail`.
2. **Contradictory tool messages** — `voice-adapter.js` only sets default success copy when `success: true`.
3. **Missing email in tool args** — validation in `retell-websocket.js` / voice routes; `requires_email: true` on errors.

## Code touchpoints

- `middleware-platform/webhooks/retell-websocket.js`
- `middleware-platform/adapters/voice-adapter.js`
- `middleware-platform/routes/voice.js` (if still mounted; prefer Retell WS path)
- `docs/voice-agent/shop-voice-agent-prompt.md`

Do not duplicate this narrative in [`docs/email/README.md`](../email/README.md).
