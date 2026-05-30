# Somo landing

Single marketing SPA for **Somo** — voice demo + provider signup CTA.

## Hero UI

See [SOMO_LANDING_HERO.md](./SOMO_LANDING_HERO.md) for hero structure, assets, breakpoints, and copy.

## Signup handoff

CTAs use `VITE_SIGNUP_URL` or `/signup?utm_source=somo`. The signup wizard ([signup.html](../../unified-dashboard/signup.html)) shares marketing tokens (white background, League Spartan, Image 1 Green Lizard `#b5e930`). Palette and component mapping: [SOMO_MARKETING_COLORS.md](../design/SOMO_MARKETING_COLORS.md). After a live demo, name/phone/use case are prefilled via `sessionStorage` key `somo_signup_prefill`. Flow details: [PROVIDER_SIGNUP_FLOW.md](./PROVIDER_SIGNUP_FLOW.md).

## Repos / paths

| Piece | Path |
|-------|------|
| Landing (Vite + React) | `unified-dashboard/somo-landing/` |
| Public demo API | `POST /api/public/dodgecall/request-call` (internal path; deferred rename) |
| Service | `middleware-platform/services/dodgecall-demo-service.js` |
| Telephony | `call_type=dodgecall_demo` on `/voice/incoming` |
| Archived legacy landing | `unified-dashboard/_archive/littlelab-landing/` |

## Hosts

| Host | Serves |
|------|--------|
| `https://myskinandcare.com` | Somo landing (Firebase Hosting → `somo-landing/build`) |
| `http://localhost:4000/` | Somo landing (middleware, local dev) |
| `https://api.myskinandcare.com` | Middleware API only |

Legacy marketing paths (`/shop`, `/landing`, `/find-provider`, etc.) redirect to `/`.

## Local dev

### Fast profile (recommended)

Heavy background workers and catalog sync block the Node event loop on large local SQLite files. Use the light profile when working on the landing:

```bash
cd middleware-platform
export DB_PATH=./middleware-dev.db
export DEV_LIGHT_START=1
export CATALOG_MASTER_SYNC_ENABLED=0
export EHR_SYNC_ENABLED=0
npm start
```

Or from repo root: `npm run start:landing --prefix middleware-platform`

Open **http://localhost:4000/** — Somo hero + “Try Our Live Demo”.

### Fast UI iteration (Vite HMR)

```bash
# Terminal 1 — API (light profile)
npm run start:landing --prefix middleware-platform

# Terminal 2 — landing UI at http://localhost:5180 (proxies /api → :4000)
npm run dev:landing:ui
```

### Full middleware (voice, RCM, workers)

```bash
cd unified-dashboard/somo-landing && npm install && npm run build
cd middleware-platform && npm start
```

### Optional: bloated local DB

If `:4000` is still slow with the light profile, `middleware-dev.db` may be very large. Back it up and start fresh, or run `VACUUM` after auditing growth.

## Env (middleware)

```bash
DODGECALL_DEMO_ENABLED=1
API_BASE_URL=http://localhost:4000
TWILIO_OUTBOUND_WEBHOOK_URL=https://YOUR-SUBDOMAIN.ngrok-free.app  # for real demo calls locally
```

| Variable | Notes |
|----------|-------|
| `DEV_LIGHT_START` | `1` skips post-listen background workers (local only) |
| `CATALOG_MASTER_SYNC_ENABLED` | `0` disables OBF catalog sync child in dev |
| `EHR_SYNC_ENABLED` | `0` disables EHR polling workers |

## Env (landing)

| Variable | Notes |
|----------|-------|
| `VITE_API_BASE` | Empty = same-origin API |
| `VITE_SIGNUP_URL` | Default `/signup?utm_source=somo` |

## Deploy (Firebase)

```bash
npm run deploy:landing-hosting
```

Builds `somo-landing` and deploys to Firebase Hosting (`myskinandcare.com`).

## Scripts

```bash
npm run build:somo-landing --prefix middleware-platform
npm run test:e2e-somo-landing --prefix middleware-platform
npm run smoke:dodgecall-demo --prefix middleware-platform
npm run start:landing --prefix middleware-platform   # light middleware for landing dev
npm run dev:landing:ui                               # Vite on :5180
```

## Signup CTA

`/signup?utm_source=somo` on the same host as the landing.
