# Edge Routing Configs for `callsomo.com`

Use **one** pattern in production. Do not mix patterns without understanding the trade-offs.

## Current production (split-domain)

**Authoritative layout:**

| Role | Host | Serves |
|------|------|--------|
| Marketing / SPA | `https://callsomo.com` | Firebase Hosting (`unified-dashboard/firebase.json` → `somo-landing/build`) |
| Middleware API | `https://api.callsomo.com` | Google **Cloud Run** (custom domain mapping + TLS) |

The landing build must target the API host explicitly:

- **`deploy:landing-hosting`** builds `somo-landing` and deploys to Firebase (same-origin API calls go to `api.callsomo.com` via browser on split-domain).

### Why `https://callsomo.com/api/*` returns HTML

Firebase Hosting rewrites unknown paths to `/index.html` for the SPA. There is **no** `/api` proxy on the UI host in the default split-domain setup, so `GET/POST …/api/…` on the **marketing domain** returns HTML, not JSON. That is **expected**; clients and tests must call **`https://api.callsomo.com`** for API routes.

To validate JSON on the UI domain, add an edge same-domain proxy (Option A) and set `PROD_ROUTING_MODE=same-domain` for smoke checks (below).

---

## Option A: Cloudflare (or similar) — same-domain `/api/*` proxy

Use when you want `https://callsomo.com/api/*` to hit middleware without changing the SPA origin.

### DNS (example)

- `callsomo.com` → frontend (proxied)
- `api.callsomo.com` → API origin (proxied), or omit if everything goes through the Worker

### Cloudflare Worker (route: `callsomo.com/api/*`)

See `infra/edge-routing/cloudflare/myskin-api-proxy/` — backend defaults to `https://api.callsomo.com`.

Result: same-domain `https://callsomo.com/api/*` reaches the API origin.

---

## Option B: Nginx reverse proxy (single host)

```nginx
server {
  listen 443 ssl http2;
  server_name callsomo.com;

  location / {
    proxy_pass https://<frontend-origin>;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /api/ {
    proxy_pass https://api.callsomo.com;
    proxy_http_version 1.1;
    proxy_set_header Host api.callsomo.com;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

Adjust `proxy_set_header Host` if your middleware expects the original browser host.

---

## Option C: Firebase Hosting + dedicated API host (split-domain) — **current default**

Firebase Hosting cannot arbitrarily reverse-proxy to an arbitrary external API in `firebase.json` rewrites alone. Split-domain keeps hosting simple:

- **Frontend:** `https://callsomo.com` (Firebase Hosting)
- **Backend:** `https://api.callsomo.com` (Cloud Run + [custom domain mapping](https://cloud.google.com/run/docs/mapping-custom-domains))
- **DNS:** Use the records Google Cloud shows for the mapped domain (often includes targets such as `ghs.googlehosted.com` or static IPs, depending on the mapping type).

### Firebase config (SPA fallback)

`unified-dashboard/firebase.json` — keep the catch-all rewrite to `index.html` for client routing.

---

## Option D: Single ingress (e.g. Railway-only)

If one platform serves both static and API with path routing (`/api/*` → middleware, `/*` → frontend), document that stack’s ingress rules here. This is **not** the current `callsomo.com` production path.

---

## Mandatory checks after changes

### 1. API host (always)

```bash
curl -sS -i https://api.callsomo.com/health
curl -sS -i -X POST https://api.callsomo.com/api/public/landing-assistant/turn \
  -H "content-type: application/json" \
  -d '{"session_id":"routing_probe","message":"hello"}'
```

Expect JSON bodies and `content-type` consistent with JSON, not `text/html`.

### 2. Same-domain proxy (only if you deployed Option A / B)

```bash
curl -sS -i https://callsomo.com/api/health
```

### 3. Routing smoke (`middleware-platform`)

Default mode is **split-domain** (`PROD_ROUTING_MODE` defaults to `split-domain`): same-domain `/api/*` checks are **skipped**; the script validates the UI is up and that **`MIDDLEWARE_API_BASE`** returns JSON for `/health` and the landing-assistant turn.

```bash
UI_BASE_URL=https://callsomo.com \
MIDDLEWARE_API_BASE=https://api.callsomo.com \
npm run verify:prod:routing-smoke --prefix middleware-platform
```

To require JSON on the **UI** origin for `/api/*`, set:

```bash
PROD_ROUTING_MODE=same-domain
```

### 4. Full prod E2E signoff

Uses the Playwright full scan/chat flow against real prod URLs. Point the API at the middleware host (not the marketing domain):

```bash
PLAYWRIGHT_BROWSERS_PATH=0 \
UI_BASE_URL=https://callsomo.com \
MIDDLEWARE_API_BASE=https://api.callsomo.com \
npm run verify:prod:full-e2e-signoff --prefix middleware-platform
```

The underlying script is `scripts/playwright-full-scan-chat-e2e.cjs`; it reads `UI_BASE_URL` and `MIDDLEWARE_API_BASE` from the environment.

**Note:** Occasional **429** responses on assistant turns are rate-limiting, not routing bugs. Retry or backoff if a gate flakes under load.
