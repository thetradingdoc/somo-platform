# Production Playwright suites

> **Last reviewed:** 2026-05-25

Matrix for browser tests against **production** or **staging** URLs. Local landing tests use [`middleware-platform/playwright.config.cjs`](../../middleware-platform/playwright.config.cjs) instead.

## Commands (`middleware-platform/`)

| npm script | Config | When to run |
|------------|--------|-------------|
| `npm run test:prod:smoke` | `playwright.prod.config.cjs` → `prod-smoke` project | After deploy; quick prod health |
| `npm run test:prod:mobile` | `playwright.prod.config.cjs` → `prod-mobile` project | Mobile viewport checks on prod |
| `npm run test:prod:full` | `playwright.prod.config.cjs` (all projects) | Full prod matrix |

**Known gap:** `playwright.prod.config.cjs` is referenced in `package.json` but may be absent from the repo. If commands fail, use local landing suites below or restore the prod config from deployment history.

## Local / CI landing suites (not prod)

| npm script | Scope |
|------------|--------|
| `npm run test:e2e-landing` | Build landing + all `e2e/landing*.spec.cjs` |
| `npm run test:e2e-landing:find-provider` | Find-provider flow |
| `npm run test:e2e-funnel` | Funnel match + preview specs |
| `npm run test:e2e-landing:scan-suite:build` | Scan chat suite (build + chromium) |
| `npm run test:e2e-chat-scan-gate` | Two-turn scan gate (also runs in CI) |

Specs live under `middleware-platform/e2e/` and `middleware-platform/tests/e2e/`.

## Environment

Set before prod runs:

```bash
export UI_BASE_URL=https://myskinandcare.com
export MIDDLEWARE_API_BASE=https://api.myskinandcare.com
```

CI deploy job uses `npm run verify:prod:routing-smoke` (routing readiness, not full Playwright matrix). See [PROD_MONITORING_WORKFLOWS.md](../runbooks/PROD_MONITORING_WORKFLOWS.md).

## Related

- [testing README](./README.md)
- [`middleware-platform/package.json`](../../middleware-platform/package.json) — full script list
