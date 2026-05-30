# Somo landing

Single marketing SPA for **Somo** — served at `http://localhost:4000/` and `https://myskinandcare.com/` (Firebase Hosting).

## Dev

```bash
# Same-origin (recommended)
cd unified-dashboard/somo-landing && npm install && npm run build
cd middleware-platform && npm start
# → http://localhost:4000/

# Hot reload (optional)
npm run dev   # http://localhost:5180, proxies /api → :4000
```

## Build

```bash
npm run build
```

Output: `build/` (served from middleware and Firebase Hosting).

## Styles

| File | Scope |
|------|--------|
| `src/styles/somo.css` | Tokens, base, imports |
| `src/styles/somo-hero.css` | Nav, hero, trust bar |
| `src/styles/somo-demo.css` | Demo form, floating CTA, footer |

Hero behavior: [docs/deployment/SOMO_LANDING_HERO.md](../../docs/deployment/SOMO_LANDING_HERO.md).

## Env

| Variable | Dev (:4000) | Notes |
|----------|-------------|-------|
| `VITE_API_BASE` | empty | Same-origin `/api/public/dodgecall/...` (internal path) |
| `VITE_SIGNUP_URL` | `http://127.0.0.1:4000/signup?utm_source=somo` | Set in `.env.development` |
| `VITE_LOGIN_URL` | `/login?utm_source=somo` (proxied to :4000 in `npm run dev`) | Provider sign-in |
