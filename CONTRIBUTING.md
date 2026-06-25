# Contributing to Somo

## Branching and pull requests

- Open PRs against `main` (or `develop` if your team uses it).
- Keep changes focused; match existing style in touched files.
- Describe **what** changed and **why** in the PR body.

## Prerequisites

- **Node.js:** Local development targets **v20+** (see `README.md`). CI also runs on **Node 18.x** for compatibility; if you use 18 locally, run the same checks before pushing.
- **npm** 8+.

## Environment

- **Middleware:** copy `middleware-platform/.env.example` → `.env` and fill secrets.

## Architecture overview

- **High-level map:** [`docs/middleware-platform/README.md#architecture`](docs/middleware-platform/README.md#architecture) (middleware vs `unified-dashboard`, CI pointers).
- **Consumer video health:** [`docs/product/VIDEO_HEALTH.md`](docs/product/VIDEO_HEALTH.md).

## Commands to run before opening a PR

Mirror what CI exercises (see `.github/workflows/ci.yml`):

```bash
# 1) Middleware — install, syntax, tests, security gate
cd middleware-platform && npm ci && npm test && npm run release:security-gate && cd ..

# 2) Repo root — guardrails
node scripts/check-performance-budgets.cjs
node scripts/check-auth-ui-guardrails.cjs
RETENTION_DRY_RUN=1 node scripts/retention-cleanup.cjs
npm run ci:gate
```

## Documentation

- Canonical docs live under **`docs/`** (`docs/README.md` index).
- Kelly / LLM debug flags: **`docs/development/README.md#kelly-env-and-debug`**.
- CI vs deploy expectations: **`docs/deployment/README.md#ci-and-deploy-source-of-truth`**.
- Agentic checkout (removed 2026-06): historical notes in [`docs/architecture/README.md`](../architecture/README.md#commerce-agentic-checkout-file-map).
- `server.js` growth policy: **`docs/development/README.md#server-js-refactor-policy`**.
- Quarterly doc/CI hygiene: **`docs/development/README.md#periodic-maintenance`**.
- Secret scanning expectations: **`docs/security/SECRET_SCANNING.md`**.
- Future structured logging: **`docs/development/README.md#structured-logging-future`**.

## API contract

- **`middleware-platform/openapi.yaml`** documents the public API surface. Update it when you add or change REST routes that belong in the contract (not validated in active CI).

## Tests

- Middleware Jest is configured with **`jest --passWithNoTests`**; add real tests under `middleware-platform/__tests__/`.
- **Playwright** (middleware): specs live under `middleware-platform/e2e/`. CI runs **Jest + `release:security-gate`** on every PR (see `.github/workflows/ci.yml`); **full Playwright** is not in the default job—run locally or add a scheduled/manual workflow when you need browser coverage against a live API.
- **Playwright browsers:** before first run, install Chromium: `cd middleware-platform && npx playwright install chromium` (CI sandboxes that skip this will fail with “browser not found”).
- There is **no Cypress** tree in `middleware-platform` right now — the workflow step skips when `cypress/` is absent.

## Security

- Do not commit secrets. The CI **Security** job runs `npm audit` and a crude `grep` for common secret patterns; both are imperfect. Prefer **GitHub secret scanning** / org-level tools (e.g. gitleaks) for real guarantees.
- Rotate keys if anything sensitive was ever committed, even if removed later.

## Repo root shortcut

From the repository root (no extra install; uses Node only):

```bash
npm run ci:local
```

Runs performance budgets, auth UI guardrails, retention cleanup **dry-run**, then full **`ci:gate`** (middleware Jest, Kelly verifies, security gate). Install middleware deps first: `cd middleware-platform && npm ci` (or `npm install`).
