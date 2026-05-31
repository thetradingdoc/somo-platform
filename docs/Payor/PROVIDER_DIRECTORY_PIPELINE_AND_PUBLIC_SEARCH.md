# Provider directory pipeline and public search

> **Last reviewed:** 2026-05-25

Public provider search backed by NPPES ingest and entity resolution. Related contracts: [`PROVIDER_NETWORK_INGESTION_CONTRACTS.md`](./PROVIDER_NETWORK_INGESTION_CONTRACTS.md).

## Data pipeline (offline)

1. **NPPES bulk import** — CMS dissemination files → `provider_registry_*` tables (migrations `039_nppes_*`, `050_nppes_fhir_endpoints`).
2. **Entity resolution** — normalize → block → fuzzy → resolve → canonicalize (see [`PAYOR_ARCHITECTURE_AND_ENTITY_RESOLUTION.md`](./PAYOR_ARCHITECTURE_AND_ENTITY_RESOLUTION.md)).
3. **Network linking** — `provider_payer_networks` links providers to payor entities for in-network precheck.

Operator commands: [`PAYOR_CMS_TRACK_RUNBOOK.md`](./PAYOR_CMS_TRACK_RUNBOOK.md), `npm run run:payor:cms-pipeline`.

## Runtime search service

Implementation: [`middleware-platform/services/provider-search-service.js`](../../middleware-platform/services/provider-search-service.js)

`listProviderSearchResults({ taxonomyCode, latitude, longitude, radiusMiles, payorEntityId, page, pageSize })`:

- Reads `provider_registry_entities` + taxonomy and payer network joins
- Optional geo filter when lat/lon/radius provided
- Returns paginated active providers with taxonomy and provenance metadata

## HTTP API (intended)

`server.js` mounts:

```javascript
app.use('/api/public/providers', publicCatalogReadLimiter, publicProviderSearchRoutes);
```

**Code gap (2026-05-25):** `require('./routes/public-provider-search.js')` is referenced in [`server.js`](../../middleware-platform/server.js) but **`middleware-platform/routes/public-provider-search.js` is missing** from the repo. Restore the route module or remove the mount in a follow-up PR.

Expected query params (when route exists): taxonomy code, geo, payor entity id, pagination.

## Landing UI

Find-provider E2E: `npm run test:e2e-landing:find-provider` (Playwright). Historically referenced `FindProvider.js` in archived `_archive/littlelab-landing`.

## Feature flags

| Env | Effect |
|-----|--------|
| `PROVIDER_NETWORK_PRECHECK_ENABLED` | Attach network decision in eligibility/claims |
| `PROVIDER_NETWORK_PRECHECK_SHADOW` | Log decision without gating |
| `PAYOR_CANONICAL_RESOLVER_ENABLED` | Resolve payor via canonical registry |

## Related

- [`docs/Payor/README.md`](./README.md)
- [`public-plan-search.js`](../../middleware-platform/routes/public-plan-search.js) — Medicare plan search (separate surface)
