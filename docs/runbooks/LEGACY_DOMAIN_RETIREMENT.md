# Legacy domain retirement (myskinandcare.com)

After **callsomo.com** is stable for 24–48 hours:

## DNS redirects (registrar)

Configure at **Squarespace** (DNS for callsomo.com) or your myskin registrar:

| From | To |
|------|-----|
| `https://myskinandcare.com/*` | `https://callsomo.com` (301 permanent) |
| `https://www.myskinandcare.com/*` | `https://www.callsomo.com` (301) |
| `https://api.myskinandcare.com/*` | `https://api.callsomo.com/$1` (301) optional |

Squarespace: **Settings → Domains → myskinandcare.com → Domain Forwarding** (or URL redirect), not only A-record changes.

Verify after 301:

```bash
curl -sI https://myskinandcare.com/ | grep -i '^location:'
curl -sI https://callsomo.com/login | grep -i '^HTTP'
```

## GCP `doctor-little-c688d`

```bash
gcloud beta run domain-mappings delete --domain=api.myskinandcare.com \
  --region=us-central1 --project=doctor-little-c688d
```

Remove Firebase custom domain for `myskinandcare.com` in Firebase Console.

## Azure / doclittle.site

Historical only. Tear down in Azure Portal / IONOS if still active.
