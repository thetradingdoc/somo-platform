# Staging on myskinandcare.com (retired)

This runbook is **superseded**. Staging and production cutover for Somo use **callsomo.com**.

**Canonical operator guide:** [CALLSOMO_GCP_CUTOVER.md](../runbooks/CALLSOMO_GCP_CUTOVER.md)

**Legacy DNS redirects:** [LEGACY_DOMAIN_RETIREMENT.md](../runbooks/LEGACY_DOMAIN_RETIREMENT.md)

| Role | URL |
|------|-----|
| UI | `https://callsomo.com` |
| API | `https://api.callsomo.com` |
| Firebase Hosting | project `somo-4ddf6` |
| Cloud Run | project `somo-callsomo`, service `myskin-middleware` |
