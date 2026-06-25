# Middleware automated tests

## Coverage map (revenue paths)

| Path | Jest / Playwright | Notes |
|------|-------------------|-------|
| Voice multitenancy | `voice-inbound-tenant.test.js`, `voice-incoming-handler.test.js`, `voice-call-tenant-scope.test.js` | HTTP T2.6 in `billing:test-gate` (restart server after gate changes) |
| Signup / trial | `trial-lifecycle.test.js`, `billing-access-gate.test.js` | Staging: `test:e2e:staging-signup` |
| Checkout / commerce | `stripe-webhook-canceled.test.js`, repo `verify-agentic-checkout.cjs` | Staging-dependent HTTP gates documented as norm |
| RCM / Kelly | `rcm-tenant-isolation.test.js`, `rcm-payment-idempotency.test.js`, `e2e/kelly-rcm-golden-path.spec.cjs` | Conversation E2E: `test:e2e:rcm:conversation` |
| Payor | `payor-*.test.js` suites | HTTP smoke optional with `RUN_PAYOR_HTTP_SMOKE=1` |
| Reasoning | `reasoning-pipeline.test.js`, `reasoning-gates-fsm.test.js`, `result-summary-contract-guards.test.js` | CI: `npm run test:reasoning-regression` + `eval:reasoning:harness` |

See [`docs/meta/PO_SURFACE_SCORECARD.md`](../docs/meta/PO_SURFACE_SCORECARD.md) for RAG per surface.

## Jest (`npm test`)

- **Environment:** `jest.config.js` + `jest.setup.js` (`NODE_ENV=test`, in-memory DB via `DB_PATH=:memory:`).
- **Scope:** `__tests__/*.test.js` (not `__tests__/smoke/` or `e2e/`).
- **CI:** `.github/workflows/ci.yml` runs `npm test` plus voice/booking smoke and `test:reasoning-regression`.

Retired landing-scan / littlelab-assistant Jest and Playwright were removed (2026-06); services remain, regression is reasoning harness + revenue-path suites above.

## HTTP smoke (optional server)

| File | Run |
|------|-----|
| `smoke/payor-location-smoke.test.js` | `npm run test:payor:location-smoke` (server on `:4000`) |

See `PAYOR_SEARCH_TEST_GUIDE.md`.

## Other runners

- **Staging:** `test:e2e:staging`, `test:e2e:staging-signup`, `test:e2e:staging-voice` (see `playwright.staging.config.cjs`).
- **Navigation contracts:** `npm run test:navigation:contracts` — routing, orchestrator, seed idempotency.
- **Acne journey eval (plain Node):** `npm run test:eval-engine` → `tests/e2e/eval-engine.unit.test.js`.
- **Reasoning eval (CI):** `npm run eval:reasoning:harness`.

## What not to add under `__tests__/`

- Duplicated logic copied from `patient-app/` (test the real module in the app or shared `lib/`).
- Opt-in HTTP smokes — use `__tests__/smoke/` and an env flag so `npm test` stays offline and fast.
