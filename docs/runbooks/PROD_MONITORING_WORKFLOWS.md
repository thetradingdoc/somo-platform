# Production monitoring workflows

> **Last reviewed:** 2026-05-25

What actually runs today for prod health — no invented scheduled jobs.

## GitHub Actions (on push to main/master)

From [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml):

| Step | Job | Purpose |
|------|-----|---------|
| Jest + reasoning gates | `test` | Unit/regression on every PR/push |
| `npm run verify:prod:routing-smoke` | `deploy` | Prod URL routing check after merge to main |
| Heuristic secret grep | `security` | Best-effort; not full secret scanning |

There is **no** dedicated scheduled workflow in-repo for nightly Playwright against prod. Run prod browser tests **manually** when needed.

## Manual prod checks

From `middleware-platform/`:

```bash
# Routing / API reachability (same as CI deploy job)
npm run verify:prod:routing-smoke

# Browser smoke (requires playwright.prod.config.cjs)
UI_BASE_URL=https://callsomo.com \
MIDDLEWARE_API_BASE=https://api.callsomo.com \
npm run test:prod:smoke
```

Full matrix: [PROD_PLAYWRIGHT_SUITES.md](../testing/PROD_PLAYWRIGHT_SUITES.md).

## Medical coding regression

Not in CI deploy job by default. Before coding releases:

```bash
SKIP_STARTUP_MIGRATIONS=1 RAG_API_URL=disabled EVAL_USE_SEMANTIC=false npm run eval:coding
npm run verify:prod-codebook
```

See [Medical Coding/OPERATIONS.md](../Medical%20Coding/OPERATIONS.md).

## Payor ingest signals

Optional webhook: `PAYOR_INGEST_METRICS_WEBHOOK_URL` in middleware `.env`. Operator runbooks:

- [`PAYOR_INGEST_FAILURE_RECOVERY.md`](./PAYOR_INGEST_FAILURE_RECOVERY.md)
- [`PAYOR_BATCH_REPROCESSING.md`](./PAYOR_BATCH_REPROCESSING.md)

## Recommended org-level monitoring

- GitHub Advanced Security secret scanning
- Cloud Run metrics + alerting (latency, 5xx)
- Firebase Hosting uptime
- External uptime on `https://api.callsomo.com/health`

Secret hygiene: [SECRET_SCANNING.md](../security/SECRET_SCANNING.md).

## Related consolidated runbooks

Incident playbooks (Stripe, Stedi, reasoning, DLQ): [`docs/runbooks/README.md`](./README.md).
