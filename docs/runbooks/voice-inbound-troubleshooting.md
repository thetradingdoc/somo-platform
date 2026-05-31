# Voice inbound troubleshooting

> **Last reviewed:** 2026-05-30  
> **When:** Call connects but is silent, wrong tenant, or no `voice_call_log` row.

## Path

```text
Caller → Twilio DID → POST /voice/incoming?customer_id=…
       → TwiML / Retell bridge
       → Retell agent → WebSocket retell-websocket.js
       → Kelly / tools → voice_call_log, voice_call_states
```

## Checklist (in order)

### 1. Twilio

- [ ] Voice URL matches `{PUBLIC_URL}/voice/incoming?customer_id={EXPECTED_ID}`
- [ ] `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` loaded (middleware boot)
- [ ] `customers.twilio_phone_number` and `twilio_phone_sid` set for owner
- [ ] Signature validation: if 403, check `TWILIO_WEBHOOK_SIGNATURE_REQUIRED` and public URL

### 2. Public URL

- [ ] `API_BASE_URL` or `NGROK_URL` is HTTPS and reachable from internet
- [ ] Middleware restarted after env change
- [ ] `curl -s "$PUBLIC/health"` returns 200

### 3. Tenant resolution

- [ ] Middleware logs show `customer_id` = owner (not default / akin-dunbar)
- [ ] Query: `SELECT customer_id, call_id FROM voice_call_log ORDER BY created_at DESC LIMIT 5`

### 4. Retell

- [ ] `customers.retell_agent_id` present
- [ ] Retell dashboard agent webhook / WS points to same public host as middleware
- [ ] `RETELL_API_KEY` set; no 401 in logs
- [ ] If WS disconnects: confirm `customer_id` on `voice_call_states` after W2-01

### 5. Kelly / LLM

- [ ] `KELLY_PRIMARY_PROVIDER` keys present if expecting LLM replies
- [ ] Groq/Anthropic circuit not open for all providers

## SQL snippets

```sql
SELECT id, email, twilio_phone_number, retell_agent_id, merchant_id
FROM customers WHERE id = ?;

SELECT call_id, customer_id, created_at FROM voice_call_log
ORDER BY created_at DESC LIMIT 10;
```

## Related

- [SOMO_FOUNDATION_RUNBOOK.md](../Database/SOMO_FOUNDATION_RUNBOOK.md)
- [ENV_AND_DB_SSOT.md](../Database/ENV_AND_DB_SSOT.md)
