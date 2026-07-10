# Voice routing — single source of truth

Last updated: 2026-07-04

## Phone roles

| Number | Role | Routing world |
|--------|------|----------------|
| **+13639990205** | Somo **company sales line** — Kelly inbound qual, tenant account help, human handoff | `platform_support` |
| **+18623622415** | **Tenant** practice line (when a real practice exists) | `tenant` |
| Personal mobile | `CALLSOMO_OPERATOR_FALLBACK_PSTN` — human handoff from platform line | PSTN transfer |

## Disabled / retired

- **Consumer navigation on PSTN** — `NAVIGATION_ENABLED=0`, `PLATFORM_INBOUND_MODE=support`
- **Landing demo call API** — `/api/public/somo-demo/request-call` removed; landing CTA → `/signup`
- **Fake "Somo practice" tenant** for portal E2E — blocked until real signup
- **Do not run** `navigation-gcs-seed.cjs` expecting navigation on 363 unless `PLATFORM_INBOUND_MODE=navigation`

## Deploy checklist (363)

1. `node scripts/bind-operator-platform-did.cjs` on GCS snapshot
2. Cloud Run env: `NAVIGATION_ENABLED=0`, `PLATFORM_INBOUND_MODE=support`, `CALLSOMO_OPERATOR_FALLBACK_PSTN`
3. `node scripts/callsomo-operator-sync.cjs`
4. Inbound test → `routing_world=platform_support`; connect opener = Kelly sales (no name-first intake)
5. Handoff test: caller says "human" → transfer to `CALLSOMO_OPERATOR_FALLBACK_PSTN`
6. `node scripts/platform-routing-post-deploy-verify.cjs --session <call_id>`
7. `node scripts/verify-crm-pipeline.cjs` — see [PLATFORM_SALES_363_DEPLOY.md](../deployment/PLATFORM_SALES_363_DEPLOY.md)

## Lead sources (admin CRM)

| Source | Origin |
|--------|--------|
| `jsearch` | Job board scrape |
| `craigslist` | Craigslist RSS scrape |
| `inbound_platform` | Inbound call to +13639990205 |

## 862 before real tenant

Archived Doclittle tenant: inbound to +18623622415 returns fail-closed TwiML until a real practice is bound.
