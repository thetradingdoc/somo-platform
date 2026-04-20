# Contributing to DocLittle

## Branching and pull requests

- Open PRs against `main` (or `develop` if your team uses it).
- Keep changes focused; match existing style in touched files.
- Describe **what** changed and **why** in the PR body.

## Prerequisites

- **Node.js:** Local development targets **v20+** (see `README.md`). CI also runs on **Node 18.x** for compatibility; if you use 18 locally, run the same checks before pushing.
- **npm** 8+.

## Environment

- **Middleware:** copy `middleware-platform/.env.example` → `.env` and fill secrets.
- **Patient app:** see `patient-app/.env.example` and `patient-app/config.ts` for `EXPO_PUBLIC_*` variables.

## Architecture overview

- **High-level map:** [`docs/middleware-platform/README.md#architecture`](docs/middleware-platform/README.md#architecture) (middleware vs `unified-dashboard`, checkout flow, CI pointers; consolidated middleware docs).

## Commands to run before opening a PR

Mirror what CI exercises (see `.github/workflows/ci.yml`):

```bash
# 1) Middleware — install, syntax, tests, security gate
cd middleware-platform && npm ci && npm test && npm run release:security-gate && cd ..

# 2) Repo root — guardrails + agentic checkout static verify
node scripts/check-performance-budgets.cjs
node scripts/check-auth-ui-guardrails.cjs
RETENTION_DRY_RUN=1 node scripts/retention-cleanup.cjs
node scripts/verify-agentic-checkout.cjs

# 3) Patient app (Expo) — typecheck
cd patient-app && npm ci && npx tsc --noEmit && cd ..
```

Optional: `cd patient-app && npm run lint` (not all CI jobs run Expo lint yet).

## Documentation

- Canonical docs live under **`docs/`** (`docs/README.md` index).
- Kelly / LLM debug flags: **`docs/development/README.md#kelly-env-and-debug`**.
- CI vs deploy expectations: **`docs/deployment/README.md#ci-and-deploy-source-of-truth`**.
- Agentic checkout (which file owns what): **`docs/architecture/README.md#commerce-agentic-checkout-file-map`**.
- `server.js` growth policy: **`docs/development/README.md#server-js-refactor-policy`**.
- Quarterly doc/CI hygiene: **`docs/development/README.md#periodic-maintenance`**.
- Secret scanning expectations: **`docs/security/SECRET_SCANNING.md`**.
- Future structured logging: **`docs/development/README.md#structured-logging-future`**.

## API contract

- **`middleware-platform/openapi.yaml`** is validated in CI. If you add or change REST routes that belong in the public API surface, **update `openapi.yaml`** in the same PR (or follow up immediately if the change is urgent).

## Agentic checkout

- Static verification: `npm run verify:agentic-checkout` from repo root (or `patient-app` script of the same name).

## Tests

- Middleware Jest is configured with **`jest --passWithNoTests`**; add real tests under `middleware-platform/__tests__/`.
- **Playwright** (middleware): specs live under `middleware-platform/e2e/`. CI runs **Jest + `release:security-gate`** on every PR (see `.github/workflows/ci.yml`); **full Playwright** is not in the default job—run locally or add a scheduled/manual workflow when you need browser coverage against a live API.
- **Playwright browsers:** before first run, install Chromium: `cd middleware-platform && npx playwright install chromium` (CI sandboxes that skip this will fail with “browser not found”).
- **Checkout E2E base URL:** set `CHECKOUT_E2E_BASE_URL` to the middleware origin serving static files (often `http://127.0.0.1:4000`). The checkout page uses `window.API_BASE` (default `http://localhost:4000`); if you open the HTML via `127.0.0.1` but leave the default API base, requests can go to the wrong origin—override `API_BASE` in an init script or match host (`localhost` vs `127.0.0.1`) consistently.
- There is **no Cypress** tree in `middleware-platform` right now — the workflow step skips when `cypress/` is absent.

## Security

- Do not commit secrets. The CI **Security** job runs `npm audit` and a crude `grep` for common secret patterns; both are imperfect. Prefer **GitHub secret scanning** / org-level tools (e.g. gitleaks) for real guarantees.
- Rotate keys if anything sensitive was ever committed, even if removed later.

## Repo root shortcut

From the repository root (no extra install; uses Node only):

```bash
npm run ci:local
```

Runs performance budgets, auth UI guardrails, retention cleanup **dry-run**, agentic checkout verify, then **`middleware-platform` Jest** and **`release:security-gate`**. Install middleware deps first: `cd middleware-platform && npm ci` (or `npm install`).
