# Middleware automated tests

## Jest (`npm test`)

- **Environment:** `jest.config.js` + `jest.setup.js` (`NODE_ENV=test`, in-memory DB via `DB_PATH=:memory:`).
- **Scope:** `__tests__/*.test.js` only (not `__tests__/manual/` or `e2e/`).
- **CI:** `.github/workflows/ci.yml` runs `npm test` (~53 suites / 306 tests, no skipped payor HTTP cases).

## Manual Node harnesses (`__tests__/manual/`)

Run with **Node** when changing conflict graph, INCI resolve, retriever, or full routine reasoning pipeline:

| File | Run |
|------|-----|
| `manual/inci-resolve.test.js` | `node __tests__/manual/inci-resolve.test.js` |
| `manual/ingredient-conflict-graph.test.js` | `node __tests__/manual/ingredient-conflict-graph.test.js` |
| `manual/retriever-vector-merge.test.js` | `node __tests__/manual/retriever-vector-merge.test.js` |
| `manual/routine-reasoning-eval.test.js` | `node __tests__/manual/routine-reasoning-eval.test.js` |

## HTTP smoke (optional server)

| File | Run |
|------|-----|
| `smoke/payor-location-smoke.test.js` | `npm run test:payor:location-smoke` (server on `:4000`) |

See `PAYOR_SEARCH_TEST_GUIDE.md`.

## Other runners

- **Playwright (landing / scan):** `e2e/*.spec.cjs` — see `package.json` scripts (`test:e2e-landing`, etc.).
- **Funnel API E2E (middleware on :4000):** `npm run test:e2e-funnel` — `landing-funnel-match` + `landing-funnel-preview` specs only (no CRA build).
- **Acne journey eval (plain Node):** `npm run test:eval-engine` → `tests/e2e/eval-engine.unit.test.js`.
- **Reasoning eval (CI):** `npm run eval:reasoning:harness` (not the manual routine-reasoning file).

## Repo root

- `scripts/check-get-app.spec.js` is **Playwright**; requires a running server (e.g. `localhost:4000`). Not part of `middleware-platform` Jest.

## What not to add under `__tests__/`

- Duplicated logic copied from `patient-app/` (test the real module in the app or shared `lib/`).
- Opt-in HTTP smokes — use `__tests__/smoke/` and an env flag so `npm test` stays offline and fast.
