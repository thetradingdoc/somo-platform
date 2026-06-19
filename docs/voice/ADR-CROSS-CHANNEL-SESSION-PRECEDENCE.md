# ADR: Cross-channel session precedence (B6)

**Status:** Accepted  
**Date:** 2026-06-18

## Context

A patient may have simultaneous voice (Retell) and chat (portal) sessions. `patient_orchestrate_sessions` and Kelly `kelly_rails_session_projection` can diverge.

## Decision

1. **Voice SSOT:** `kelly_rails_session_projection` + `hydrateSessionForTurn()` wins for active Retell `call_id` / voice `session_id`.
2. **Chat SSOT:** orchestrator session keyed by explicit chat `session_id`; no phone-global resume on chat when voice session is active for same patient+clinic.
3. **Precedence:** When both channels active for same `patient_id` + `clinic_id`, **voice turn writes take precedence** for shared flags until voice session ends; chat receives `channel_conflict` event in activity feed.
4. **Resume:** Voice resume requires verified `clinic_id` (R-03); chat may resume by `session_id` only.

## Consequences

- Documented winner removes silent race; full merge UI deferred.
- WS reconnect revalidates site context per [ADR-WS-RECONNECT-SITE-CONTEXT.md](./ADR-WS-RECONNECT-SITE-CONTEXT.md).
