# ADR: WebSocket reconnect + CallSiteContext revalidation (SITE-30 / LX-12)

**Status:** Accepted  
**Date:** 2026-06-19

## Context

Retell voice WebSocket connections can drop and reconnect mid-call. On reconnect, runtime must not reuse stale `clinic_id` from env heuristics or partial hydration.

## Decision

1. **Hydrate from projection first:** `hydrateSessionForTurn()` in `kelly-rails/hydrate.js` is the single read path at turn start (projection + meta_kv + triage row).
2. **Revalidate site on WS connect:** `retell-websocket.js` calls `resolveCallSiteContext()` with DID-first lookup and upserts `call_site_context`.
3. **Pass `site_context_status` on every turn** via connection state → `turnOpts` → tool firewall / executor.
4. **meta_kv orchestration keys demoted (SITE-32):** Lane/mode/subrail live in `kelly_rails_session_projection.flags_json`; meta_kv reserved for payment tokens and ephemeral flags. Phase 1: `meta-kv-policy.js` blocks orchestration keys in `_setSessionMeta`; `mirrorMetaFromPayload` remains the approved mirror path.
5. **Orchestrate session sync (B6):** On WS connect after verified `call_site_context`, `patient_orchestrate_sessions.clinic_id` is synced from site context. Mismatch vs prior row logs `orchestrate_site_mismatch` (booking tools fail-closed until aligned).

## Consequences

- Reconnect does not downgrade verified site to `merchant LIMIT 1` fallback.
- Booking/clinical tools remain blocked if site becomes ambiguous after reconnect audit.
- Provider forensics show `call_site_context_resolved` at ingress and WS.

## References

- `services/call-site-context.js`
- `services/kelly/rails/hydrate.js` — `hydrateSessionForTurn()`
- `webhooks/retell-websocket.js` — hydration block
- Epic: `todos/VOICE-SITE-ESC-EPIC.md`
