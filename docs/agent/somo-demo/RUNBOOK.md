# Somo demo demo agent — runbook

**Last updated:** 2026-05-28

## Prerequisites

1. `middleware-platform/.env` — see env table below.
2. **Local dev minimum:** `DODGECALL_DEMO_ENABLED=1` plus existing `RETELL_AGENT_ID` and `TWILIO_PHONE_NUMBER` (no separate `DODGECALL_*` required).
3. **P0-5:** Public `API_BASE_URL` (ngrok or Railway) for real Twilio calls.
4. Optional: dedicated `DODGECALL_RETELL_AGENT_ID` / `DODGECALL_TWILIO_FROM_NUMBER` for production isolation.

## Env

| Variable | Required | Notes |
|----------|----------|--------|
| `DODGECALL_DEMO_ENABLED` | yes | `1` on; `0` disables API + WS demo branch |
| `DODGECALL_RETELL_AGENT_ID` | optional | Falls back to `RETELL_SALES_AGENT_ID`, then `RETELL_AGENT_ID` |
| `DODGECALL_TWILIO_FROM_NUMBER` | optional | Falls back to `TWILIO_PHONE_NUMBER` |
| `DODGECALL_DEMO_VOICE_ID` | optional | Falls back to `RETELL_VOICE_ID` for configure script |
| `DODGECALL_SMS_FROM_NUMBER` | optional | Defaults to demo Twilio FROM |
| `DODGECALL_SIGNUP_URL` | optional | Default `/signup?utm_source=dodgecall` |
| `DODGECALL_DEMO_MAX_DURATION_SEC` | optional | Default `240` |
| `DODGECALL_DEMO_MAX_CONCURRENT` | optional | Default `3` |
| `DODGECALL_DEMO_DAILY_CAP` | optional | Default `100` |
| `API_BASE_URL` | yes for telephony | Must be reachable by Twilio |
| `RETELL_API_KEY` | yes for configure | |

## Configure Retell demo agent

```bash
cd middleware-platform
npm run configure:dodgecall-demo
```

Sets custom LLM WebSocket, voice, minimal tools (`end_call`, `record_interest`, `send_signup_link`).

## Local landing

```bash
cd unified-dashboard/somo-landing && npm install && npm run build
cd middleware-platform && npm start
# Open http://localhost:4000/
```

## Rollback (no code deploy)

```bash
DODGECALL_DEMO_ENABLED=0
# Restart middleware
```

## Smoke / tests

```bash
npm run smoke:dodgecall-demo --prefix middleware-platform
npm run test:e2e-dodgecall --prefix middleware-platform
npm test -- --testPathPattern=dodgecall
```

## Verification checklist

- [ ] Demo call greeting says **Somo demo** / **Sam**, not Kelly/Somo.
- [ ] Logs show `somo-demo-handler`, not `KellyAgentService.processTurn`.
- [ ] `DODGECALL_DEMO_ENABLED=0` rejects form API.
- [ ] Call ends within max duration.
- [ ] Voicemail/no-answer updates `outcome` on demo request row.

## ngrok example

```bash
ngrok http 4000
# Set API_BASE_URL=https://xxxx.ngrok-free.app in .env
# Re-run configure:dodgecall-demo
```
