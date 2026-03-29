# CI and deployment — source of truth

## Continuous integration

Workflow file: **`.github/workflows/ci.yml`**

- **Triggers:** push/PR to `main`, `master`, `develop`; manual `workflow_dispatch`.
- **Test job:** runs on **Node 18.x and 20.x** (matrix). Steps include middleware `npm ci`, `node --check` on all `.js` files, Jest, repo-root scripts (perf budgets, auth UI guardrails, retention dry-run), **agentic checkout static verify**, **patient-app `tsc`**, optional Cypress (only if `middleware-platform/cypress/` exists), clinical prep gate when configured.
- **Security job:** `npm audit` (non-blocking today) and a heuristic grep for secrets (non-blocking).
- **Build job:** Starts `server.js` briefly under timeout.

**Local parity:** run the commands in **root `CONTRIBUTING.md`** before opening a PR.

## Deployment

The workflow **Deploy to Railway** job is a **placeholder**: it prints that checks passed and notes Railway may auto-deploy on push. **Actual deployment** is whatever your team configured in **Railway** (or another host) connected to this GitHub repo — that dashboard is the operational source of truth for live URLs and env vars.

The `environment.url` in the workflow is informational; confirm it matches your current production URL in Railway settings.

## E2E / browser tests

There is **no** `middleware-platform/cypress/` directory in this repository at present; the CI step **skips** Cypress when the folder is missing. Restoring E2E or documenting manual smoke tests is tracked in the platform backlog.
