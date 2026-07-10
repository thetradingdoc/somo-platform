# Middleware automated tests

## Coverage map (revenue paths)

| Path | Jest / Playwright | Notes |
|------|-------------------|-------|
| Voice multitenancy | `voice-inbound-tenant.test.js`, `voice-incoming-handler.test.js`, `voice-call-tenant-scope.test.js` | HTTP T2.6 in `billing:test-gate` (restart server after gate changes) |
| Signup / trial | `trial-lifecycle.test.js`, `billing-access-gate.test.js` | Staging: `test:e2e:staging-signup` |
| Checkout / commerce | `stripe-webhook-canceled.test.js`, repo `verify-agentic-checkout.cjs` | Staging-dependent HTTP gates documented as norm |
| RCM / Kelly | `rcm-tenant-isolation.test.js`, `rcm-payment-idempotency.test.js`, `e2e/kelly-rcm-golden-path.spec.cjs` | Conversation E2E: `test:e2e:rcm:conversation` |
| RCM money path (Ring 3) | `rcm/money-path-gates.test.js`, `resolve-amount-due.test.js`, `rcm/payment-settlement.test.js` | `npm run test:rcm:money-path`; promotion gate `npm run verify:rcm-money-path` (Jest + dental-copay + structural dental-pstn). Strict: `RCM_MONEY_STRICT=1` only — not used by multilang eval. |
| Multilang conversation eval | `scripts/kelly-multilang-conversation-eval.cjs` | `test:eval:multilang:smoke` (PR); full matrix nightly with `CONVERSATION_EVAL_STRICT=1`. Human sign-off: `verify:multilang-human-review`. |
| Payor | `payor-*.test.js` suites | HTTP smoke optional with `RUN_PAYOR_HTTP_SMOKE=1` |
| Reasoning | `reasoning-pipeline.test.js`, `reasoning-gates-fsm.test.js`, `result-summary-contract-guards.test.js` | CI: `npm run test:reasoning-regression` + `eval:reasoning:harness` |

## Phase 7 ops / release smoke

| Step | Command | Notes |
|------|---------|-------|
| Release smoke (7.8) | `npm run phase7:release-smoke` | Structural + dental HTTP replay; `PHASE7_SKIP_PORTAL=1` to skip portal gates |
| Deploy gate (7.9) | `npm run verify:phase7-deploy-gate` | `LIVE=1` for callsomo.com + Cloud Run |
| Postgres/GCS (7.1) | `npm run verify:postgres-gcs` | Use `--pull` with `GCS_DB_BUCKET` for prod snapshot |
| Mirror lag (7.2) | `npm run verify:postgres-mirror-lag` | `STRICT=1` to fail on breach |
| Vertical PSTN matrix (7.3) | `npm run vertical:pstn-scenarios` | Live PSTN: `VERTICAL_PSTN_LIVE=1` + per-vertical DID env |
| CDT codebook (7.7) | `npm run import:cdt` then `npm test -- --testPathPattern=cdt-codebook` | Seed in `Knowledge/CDT/cdt-codes-2025.txt` |
| Tenant provisioning (7.10) | `npm run verify:tenant-provisioning -- --use_case=dental` | Requires `PROVISION_*` env + optional Twilio |

Docs: `docs/qa/phase7-release-smoke.md`, `docs/qa/phase7-deploy-gate.md`, `docs/qa/pstn-vertical-matrix.md`, `docs/deployment/POSTGRES_MIRROR.md`, `docs/runbooks/ROLLBACK_DRILL.md`.

See [`docs/meta/PO_SURFACE_SCORECARD.md`](../docs/meta/PO_SURFACE_SCORECARD.md) for RAG per surface.

## Platform sales tests (+363 / `platform_support`)

| File | Purpose |
|------|---------|
| `platform-sales-persona-sequence.test.js` | **P0 gate** — connect → turn1 → turn2; forbids front-desk / virtual-assistant / Alex |
| `platform-retell-opener-wiring.test.js` | Resolver contract for `routingWorld=platform_support`, `asksName=false` |
| `somo-sales-inbound-rail.test.js` | Sales qual stages, tenant/help/handoff branches |
| `platform-support-pivot-firewall.test.js` | Isolation — no billing/clinical/book pivots on platform line |
| `demo-qual-dispatch-regression.test.js` | Enforced `demo_qual` → `SCRIPT_ONLY`, never booking hint |
| `sales-crm-tools.test.js` | `collect_contact_info` / `schedule_demo` field writes |
| `lead-outbound-consent.test.js` | TCPA outbound dial gate + score tiering (Phase 10.5) |
| `platform-sales-multilang-harness.test.js` | EN baseline only; ES/RU sales qual **deferred v1** |
| `e2e/platform-sales-admin-ui.spec.cjs` | Pipeline source filter + Kelly transcript label |

**Deferred post-v1:** outbound sales voicemail/IVR detection (parity with `operator-outbound-rail.js`).

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
