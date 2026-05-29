# Infrastructure brand deferral (until somopay.ai)

User-facing UI says **Somo**. The following **stay on legacy names** until DNS/GCP cutover to **somopay.ai**.

## Hostnames and URLs (do not rename in this pass)

| Legacy | Notes |
|--------|--------|
| `myskinandcare.com` | Production web origin |
| `api.myskinandcare.com` | API host in `.env.example`, client config |
| Firebase / GCP project IDs | Unchanged |
| GCS buckets, Cloud Run service names | Unchanged |
| [`infra/edge-routing/nginx/myskinandcare.com.conf`](../../infra/edge-routing/nginx/myskinandcare.com.conf) | Edge config |

Email and signup links may still point at `https://myskinandcare.com/...` where infra requires; display name is **Somo**.

## Internal code and routes (allowed in lint allowlist)

| Pattern | Example |
|---------|---------|
| `dodgecall-*` modules / HTTP paths | `dodgecall-demo`, `services/dodgecall-*.js` |
| `Kelly*` services | `KellyAgentService`, `KELLY_*` env vars |
| `STEDI_*` | Stedi integration env vars |
| Folder `unified-dashboard/dodgecall/` | Marketing SPA path (rename optional later) |

## Display vs infra

- **Change:** HTML titles, hero copy, CSS brand colors, manifest `name`, email From name, terms party name (UI: Somo).
- **Do not change:** API base URLs in production config, webhook URLs registered with vendors, bucket names in deploy scripts.

## Cutover checklist (future)

1. DNS: `somopay.ai` (+ `api.somopay.ai` if applicable)
2. Update `unified-dashboard/assets/js/config.js` production URLs
3. Redirect `myskinandcare.com` → new domain
4. Re-run brand lint with narrower URL allowlist
