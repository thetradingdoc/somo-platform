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
- **Patient app:** see `patient-app/.env.example` and `patient-app/config.ts` for `EXPO_PUBLIC_*` variables.

## Architecture overview

- **High-level map:** [`docs/middleware-platform/README.md#architecture`](docs/middleware-platform/README.md#architecture) (middleware vs `unified-dashboard`, checkout flow, CI pointers; consolidated middleware docs).

## Commands to run before opening a PR

Mirror what CI exercises (see `.github/workflows/ci.yml`):

```bash
# Pre-push gate (verify scripts + guardrails; mirrors CI)
npm run ci:fast
```

Optional legacy surfaces:

```bash
# Patient app (Expo) — typecheck if you touched patient-app/
cd patient-app && npm ci && npx tsc --noEmit && cd ..
```

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

## Verification (not Jest)

- **Jest and Playwright were removed** (2026-06-22). Do not add `__tests__/` without an ADR reversing [VERIFY_GATES.md](middleware-platform/docs/VERIFY_GATES.md).
- **Pre-push:** `npm run ci:fast` from repo root.
- **Middleware spine:** `cd middleware-platform && npm test` runs `prod-spine-imports` only.
- **Domain gates:** see [middleware-platform/docs/VERIFY_GATES.md](middleware-platform/docs/VERIFY_GATES.md).
- **Nightly / pre-release:** `npm run ci:slow`.

## Security

- Do not commit secrets. The CI **Security** job runs `npm audit` and a crude `grep` for common secret patterns; both are imperfect. Prefer **GitHub secret scanning** / org-level tools (e.g. gitleaks) for real guarantees.
- Rotate keys if anything sensitive was ever committed, even if removed later.

## Repo root shortcut

From the repository root (no extra install; uses Node only):

```bash
npm run ci:local
```

Runs verify scripts and repo guardrails (see `scripts/ci-local.sh`). Install middleware deps first: `cd middleware-platform && npm ci` (or `npm install`).
