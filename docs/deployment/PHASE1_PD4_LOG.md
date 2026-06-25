# Phase 1 PD-4 log (revision somo-middleware-00115-v7d)

Deployed image: `gcr.io/somo-callsomo/somo-middleware:6cdfda9` (+ env `CALLSOMO_OPERATOR_FALLBACK_PSTN` on 00115-v7d).

**Note:** GCS SQLite snapshot has zero `kelly_call_events` rows (`POSTGRES_PRIMARY=1`). PD-4 closed via live PSTN + Retell transcript verify (`phase1-retell-verify.cjs`) per [VOICE_ROUTING_ARCHITECTURE.md](../voice/VOICE_ROUTING_ARCHITECTURE.md) telemetry fallback.

| World | call_id | routing_world | verified | date |
|-------|---------|---------------|----------|------|
| demo (R-11-1) | call_6aa8b696777b8e640b3aa80c147 | demo | yes (Retell, no OPQRST) | 2026-06-23 |
| tenant (R-11-2) | call_47b4bfc88389e273f0d1131a666 | tenant | yes (Kelly on +18623622415) | 2026-06-23 |
| unidentified (R-11-3) | call_de149e6abe14b2001f0ef1d0bda | unidentified / fail-closed | yes (escalation language) | 2026-06-23 |
| platform_support (R-11-4) | call_e650ce90324172c6144c12dd3c2 | platform_support | yes (Somo line, no OPQRST) | 2026-06-23 |
| operator_outbound (R-11-5) | CA4f3cccebdf7a51a0613e37b8feb3ece1 | operator_outbound | yes (Twilio outbound + smoke) | 2026-06-23 |

## Tenant DID correction

Prod tenant PSTN: **+18623622415** (`api.callsomo.com/voice/incoming?customer_id=cust_96848972-…`).  
`+18622307479` is not provisioned on the operator Twilio account.

## Commands

```bash
npm run phase1:retell-verify --prefix middleware-platform -- --world demo --session call_xxx
npm run phase1:pull-db
```
