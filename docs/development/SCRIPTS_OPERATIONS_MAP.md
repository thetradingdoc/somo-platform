# Scripts Operations Map

**Last Updated:** 2026-04-29

## Purpose

Map operational scripts to safe usage level so engineers can run the right checks without accidental production-impacting actions.

## Tiers

- **Tier A (safe/read-only checks)**
  - verification/report scripts
  - examples: `scripts/check-*.mjs`, `scripts/report-*.cjs`, `verify:*` npm scripts

- **Tier B (controlled write to local/test state)**
  - local migrations, local seeders, local replay scripts
  - requires explicit `DB_PATH` and environment awareness

- **Tier C (external side effects / prod-adjacent)**
  - deployment scripts, remote mutation scripts, credential/domain setup scripts
  - should run only with owner approval and change tracking

## Script Families

- **Root scripts (`scripts/`)**
  - deployment and environment setup
  - UI/API smoke checks
  - docs and guardrail checks

- **Middleware scripts (`middleware-platform/scripts/`)**
  - payor pipeline, readiness, observability
  - reasoning gates and E2E checks
  - payment/ops diagnostics and recovery tasks

## Required Script Execution Notes

- Always set/verify `DB_PATH` before stateful middleware scripts.
- Prefer dry-run flags where available.
- Capture outputs for audit when running Tier C scripts.
- Link operational outcomes back to `docs/runbooks/` or `todos/` tracking items.
