# Somo landing

Marketing SPA served at **http://localhost:4000/** by middleware (build required).

## Dev

```bash
# Same-origin (recommended)
cd unified-dashboard/dodgecall && npm install && npm run build
cd middleware-platform && npm start
# → http://localhost:4000/

# Hot reload (optional)
npm run dev   # http://localhost:5180, proxies /api → :4000
```

## Build

```bash
npm run build
```

Output: `build/` (served from middleware when `GET /` on localhost or dodgecall.app).

## Env

| Variable | Dev (:4000) | Notes |
|----------|-------------|-------|
| `VITE_API_BASE` | empty | Same-origin `/api/public/dodgecall/...` |
| `VITE_SIGNUP_URL` | `http://127.0.0.1:4000/signup?utm_source=dodgecall` | Set in `.env.development` |
