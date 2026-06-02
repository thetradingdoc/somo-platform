# Legacy domain retirement (callsomo.com)

After **callsomo.com** is stable for 24–48 hours:

## DNS redirects (registrar)

Configure at **Squarespace** (DNS for callsomo.com) or your myskin registrar:

| From | To |
|------|-----|
| `https://callsomo.com/*` | `https://callsomo.com` (301 permanent) |
| `https://www.callsomo.com/*` | `https://www.callsomo.com` (301) |
| `https://api.callsomo.com/*` | `https://api.callsomo.com/$1` (301) optional |

Squarespace: **Settings → Domains → callsomo.com → Domain Forwarding** (or URL redirect), not only A-record changes.

Verify after 301:

```bash
curl -sI https://callsomo.com/ | grep -i '^location:'
curl -sI https://callsomo.com/login | grep -i '^HTTP'
```

## GCP `doctor-little-c688d`

```bash
gcloud beta run domain-mappings delete --domain=api.callsomo.com \
  --region=us-central1 --project=doctor-little-c688d
```

Remove Firebase custom domain for `callsomo.com` in Firebase Console.

## Azure / api.callsomo.com

Historical only. Tear down in Azure Portal / IONOS if still active.
