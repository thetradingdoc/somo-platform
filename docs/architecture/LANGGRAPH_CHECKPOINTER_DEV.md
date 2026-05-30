# ADR: LangGraph checkpointer in development (W3-00)

**Status:** Accepted  
**Date:** 2026-05-29

## Decision

**Development:** Use in-memory `MemorySaver` checkpointer (current default) — conversation graph state is **lost on middleware restart**.

**Production:** Postgres-backed checkpointer when `POSTGRES_URL` and LangGraph paths are enabled.

## Rationale

Local dev prioritizes fast boot and zero extra infra. Restart-loss is acceptable if documented; engineers re-test voice flows after `npm start`.

## Consequences

- Do not expect multi-turn Kelly graph continuity across dev restarts without Postgres.
- W3-07 (Retell WS reconnect) must restore `customer_id` from `voice_call_states`, not only from memory.

## Related

- [VOICE_AGENT_STATE.md](../Database/VOICE_AGENT_STATE.md)
