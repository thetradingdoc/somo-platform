# Legacy DocLittle / myskinandcare archive index

**Retired:** 2026-06-02 (callsomo.com cutover)

## Removed from repo

- Azure App Service deploy scripts (`deploy-to-azure.sh`, `configure-azure-env*`, etc.)
- `.github/workflows/deploy-infrastructure.yml`
- `middleware-platform/services/azure-domain-service.js`
- IONOS / doclittle.site DNS helper scripts
- `infra/edge-routing` myskin nginx + Cloudflare proxy
- `unified-dashboard/_archive/littlelab-landing/`

## Canonical replacement

| Topic | Doc |
|-------|-----|
| Production cutover | [`CALLSOMO_GCP_CUTOVER.md`](../../runbooks/CALLSOMO_GCP_CUTOVER.md) |
| Legacy DNS redirects | [`LEGACY_DOMAIN_RETIREMENT.md`](../../runbooks/LEGACY_DOMAIN_RETIREMENT.md) |
| Deploy / rollback | [`GCP_DEPLOY_ROLLBACK_RUNBOOK.md`](../../runbooks/GCP_DEPLOY_ROLLBACK_RUNBOOK.md) |

Historical Azure/debug notes remain under [`../azure-debug-scripts/`](../azure-debug-scripts/).
