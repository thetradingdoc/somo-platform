# Voice agent configuration vs per-call state

> **Last reviewed:** 2026-05-29

## Tenant-scoped configuration (slow-changing)

| Store | Key | Notes |
|-------|-----|-------|
| `voice_agent_settings` | `merchant_id` (or legacy `cust:{customerId}`) | Greeting, hours, enabled |
| `customers.retell_agent_id` | `customer_id` | Retell agent resource |
| `customers.custom_prompt` | `customer_id` | Cache; Week 3: Retell API is runtime SSOT |
| `prompt_profiles` | `clinic_id` today | W3-04: add `customer_id` for SaaS without clinic |
| Retell dashboard | Agent webhook / WS URL | Must match `API_BASE_URL` / ngrok (D4-02) |

## Per-call state (fast-changing)

| Table | Scoped by | `customer_id` column |
|-------|-----------|----------------------|
| `voice_call_log` | `call_id`, **`customer_id`** | Yes (billing/audit) |
| `voice_call_states` | `call_id`, `clinic_id` | **Added W2-01** (`053` migration) |
| `voice_conversation_memory` | `call_id`, `clinic_id` | **Added W2-01** |
| `agent_turns` | `call_id`, `clinic_id` | **Added W2-01** |
| `agent_state_snapshots` | `call_id` | **Added W2-01** |

Week 1 gate (V-03): test inbound call → row in `voice_call_log` with owner `customer_id`.

Week 2 gate (W2-11): same `customer_id` on `voice_call_log` and `voice_call_states` for new calls.

## Runtime (not SQLite)

| Component | Scope |
|-----------|--------|
| `retell-websocket.js` `activeConnections` | In-memory per process |
| LangGraph checkpointer | Postgres prod / MemorySaver dev (see W3-00 ADR) |

## Prompt sync (Week 3)

Target flow:

1. **Read/write Retell API** for live agent prompt/greeting.
2. **Mirror** to `customers.custom_prompt` + `voice_agent_settings` with `prompt_synced_at`.
3. UI shows “Last synced with voice provider” and surfaces Retell errors.

## Backfill

After W2-01, run:

```bash
cd middleware-platform
node scripts/backfill-voice-call-customer-id.cjs
```

Joins state tables to `voice_call_log` by `call_id` (last 30 days).

## Related

- [VOICE_PHONE_SEMANTICS.md](../architecture/VOICE_PHONE_SEMANTICS.md)
- [voice-inbound-troubleshooting.md](../runbooks/voice-inbound-troubleshooting.md)
- [TENANT_MODEL.md](./TENANT_MODEL.md)
