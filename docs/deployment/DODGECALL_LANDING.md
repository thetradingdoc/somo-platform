# DodgeCall landing

Marketing SPA and public demo-call API on the **same host** as middleware (no separate `api.dodgecall.app` until DNS exists).

## Repos / paths

| Piece | Path |
|-------|------|
| Landing (Vite + React) | `unified-dashboard/dodgecall/` |
| Public API | `POST /api/public/dodgecall/request-call` |
| Service | `middleware-platform/services/dodgecall-demo-service.js` |
| Telephony | `call_type=dodgecall_demo` on `/voice/incoming` |
| Demo agent docs | [`docs/agent/dodgecall/RUNBOOK.md`](../agent/dodgecall/RUNBOOK.md) |

## Local dev (primary)

```bash
cd unified-dashboard/dodgecall && npm install && npm run build
cd middleware-platform && npm start
```

Open **http://localhost:4000/** — DodgeCall hero + “Try Our Live Demo” (Skin & Care is not served on local `:4000`).

Optional Vite hot reload (separate port):

```bash
cd unified-dashboard/dodgecall && npm run dev   # http://localhost:5180, proxies /api → :4000
```

## Env (middleware)

```bash
DODGECALL_DEMO_ENABLED=1
# Uses RETELL_AGENT_ID + TWILIO_PHONE_NUMBER when DODGECALL_* overrides are unset
# DODGECALL_RETELL_AGENT_ID=
# DODGECALL_TWILIO_FROM_NUMBER=
API_BASE_URL=http://localhost:4000  # browser OK; Twilio needs public webhooks below
TWILIO_OUTBOUND_WEBHOOK_URL=https://YOUR-SUBDOMAIN.ngrok-free.app
```

For a **real demo call** on your laptop:

```bash
ngrok http 4000
# Copy the https URL into .env as TWILIO_OUTBOUND_WEBHOOK_URL (no trailing slash)
# Restart middleware, then submit the landing form again
```

If ngrok is running, middleware may auto-detect it at `http://127.0.0.1:4040` without setting the env var.

See [demo agent runbook](../agent/dodgecall/RUNBOOK.md) for configure script and rollback.

## Production (future)

| Host | Status |
|------|--------|
| `dodgecall.app` | Host routing in `server.js` when DNS + build deployed |
| `api.dodgecall.app` | Deferred — use same-origin API for now |

`myskinandcare.com` remains Skin & Care only (unchanged).

## Scripts

```bash
npm run build:dodgecall --prefix middleware-platform
npm run test:e2e-dodgecall --prefix middleware-platform
npm run smoke:dodgecall-demo --prefix middleware-platform
```

## Signup CTA

`/signup?utm_source=dodgecall` on the same host as the landing.

## Not DodgeCall

- `littlelab-landing` / `myskinandcare.com` — retail skincare funnel
- DocLittle voice subscription billing — provider tenants after signup
