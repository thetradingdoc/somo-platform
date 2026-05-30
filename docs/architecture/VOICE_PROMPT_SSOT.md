# ADR: Voice agent prompt single source of truth

**Status:** Accepted (implementation Week 3)  
**Date:** 2026-05-29

## Context

Agent greeting and system prompt exist in Retell, `customers.custom_prompt`, `voice_agent_settings`, and `prompt_profiles`. Edits in the UI did not always change live call behavior.

## Decision

1. **Runtime SSOT:** Retell agent API (create/update agent).
2. **DB cache:** `customers.custom_prompt`, `voice_agent_settings`, with `prompt_synced_at` timestamp.
3. **Write path:** `customer-agent` GET/PUT — Retell first, then sync DB; log failures.
4. **UI:** Show last sync time; toast on Retell failure.

## Consequences

- Greeting changes must call Retell before marking success (W3-03).
- V-04 (greeting UI = live call) is gated on W3-02–03.

## Related

- [VOICE_AGENT_STATE.md](../Database/VOICE_AGENT_STATE.md)
