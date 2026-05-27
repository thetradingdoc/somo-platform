# Voice architecture (current production)

> **Last reviewed:** 2026-05-27  
> **API host:** `https://api.myskinandcare.com` (Cloud Run `myskin-middleware`, `us-central1`)

This document is the operational source of truth for **how voice calls work today** on myskinandcare.com production. RCM product context: [`docs/RCM/KELLY_RCM_ARCHITECTURE.md`](../RCM/KELLY_RCM_ARCHITECTURE.md).

## Split-domain layout

| Role | Host |
|------|------|
| Marketing / provider SPA | `https://myskinandcare.com` |
| Middleware API | `https://api.myskinandcare.com` |

Client apps must use `REACT_APP_API_BASE=https://api.myskinandcare.com` (not the marketing host for `/api/*`).

## Inbound calls (operational)

```text
PSTN caller → Twilio number → POST /voice/incoming
  → middleware registers call (Retell v2/register-phone-call)
  → TwiML <Dial><Sip>…</Dial>
  → Retell bridges audio and opens WSS to /webhook/retell/llm
```

**Status:** Operational (verified via signed webhook test and Cloud Run `200` on `/voice/incoming`).

**Implementation:** [`middleware-platform/server.js`](../../middleware-platform/server.js) — Twilio signature required in production.

## Outbound calls (two supported paths)

### Path A — Twilio-direct (operational default in code)

```text
App or script → Twilio REST calls.create
  → webhook URL = https://api.myskinandcare.com/voice/incoming?…
  → same register + SIP + WSS flow as inbound
```

**Status:** Operational.

**Used by:**

- [`middleware-platform/scripts/make-outbound-call.js`](../../middleware-platform/scripts/make-outbound-call.js)
- [`middleware-platform/routes/outbound-call.js`](../../middleware-platform/routes/outbound-call.js) (`POST /api/voice/outbound/call`)

### Path B — Retell `create-phone-call` (custom telephony)

```text
App → Retell POST /v2/create-phone-call
  → Retell places PSTN leg via imported Twilio number + SIP trunk
  → on success, same Retell session + WSS
```

**Status:** Supported with external dependency.  
**Failure mode:** `not_connected` + `disconnection_reason=telephony_provider_permission_denied` when Retell cannot authenticate to the configured Twilio SIP termination (wrong URI, username/password, or trunk mismatch).

**Retell docs:** [Debug outbound connection issues](https://docs.retellai.com/reliability/debug-outbound-call)

## Retell agent configuration

| Setting | Production value |
|---------|------------------|
| Agent ID (example) | `agent_7f0a517ec3b01fbab225749bd5` |
| Custom LLM WebSocket | `wss://api.myskinandcare.com/webhook/retell/llm` |
| Push config from repo | `node configure-retell.js` (with `API_BASE_URL=https://api.myskinandcare.com`) |

Machine-readable inventory for `npm run verify:agent-config`: [`retell-agent-inventory.json`](./retell-agent-inventory.json) — see [`retell-agent-inventory.md`](./retell-agent-inventory.md).

## Twilio SIP (custom telephony for Path B)

When configuring Retell imported number telephony against Twilio:

| Field | Guidance |
|-------|----------|
| Origination SIP URI (Twilio trunk → Retell) | `sip:sip.retellai.com` (repo scripts expect this; confirm in Retell dashboard if region-specific) |
| Termination SIP URI (Retell → Twilio) | Must match **current** Twilio SIP domain/trunk in the **same** Twilio account as `TWILIO_ACCOUNT_SID` |
| Outbound transport | **TCP** (default in docs; do not switch to UDP without testing) |
| Auth username | Twilio credential **username** (not credential list friendly name) |

**Legacy example only (may not exist in current account):** trunk SID `TKef81908…`, domain `aimedicalvoiceagent.pstn.twilio.com`, credential list `retell-outbound`. Always verify live objects in Twilio Console before pasting into Retell.

## Smoke tests

```bash
# Liveness (Cloud Run startup probe path)
curl -sS -o /dev/null -w '%{http_code}\n' https://api.myskinandcare.com/health/live

# Retell LLM HTTP probe
curl -sS https://api.myskinandcare.com/webhook/retell/llm

# Outbound (Twilio-direct path)
cd middleware-platform && node scripts/make-outbound-call.js 8622307479

# Retell agent config vs inventory
cd middleware-platform && npm run verify:agent-config
```

## Related runbooks

- Deploy / rollback: [`docs/runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md`](../runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md)
- Edge routing: [`EDGE_ROUTING_CONFIGS.md`](./EDGE_ROUTING_CONFIGS.md)
