# Scripts layout

> Last reviewed: 2026-07-02

## Repo root `scripts/`

CI, deploy, doc hygiene, and local dev entrypoints that span multiple packages.

| Path | Purpose |
|------|---------|
| `scripts/dev/run.sh` | **Canonical local dev** — `DB_PATH=./var/db/middleware-dev.db`, light profile |
| `scripts/verify-doc-links.cjs` | Doc hygiene (`npm run verify:doc-hygiene`) |
| `scripts/phase0-verify.cjs` | Phase 0 checklist harness |
| `scripts/deploy-*`, `scripts/callsomo-*` | Production deploy and operator sync |

## `middleware-platform/scripts/`

API ops, data pipelines, Kelly/RCM verification, and one-off migrations. Run from `middleware-platform/` with `DB_PATH` set (or use `./run` from repo root).

| Examples | Purpose |
|----------|---------|
| `verify-live-*.cjs` | Post-deploy voice smoke |
| `run-payor-*`, `nppes-*` | Payor entity ingest |
| `configure-retell.js` | Push Kelly Retell agent config |
| `backup-database.js` | SQLite backup |

**Rule of thumb:** if it needs `middleware-platform/database.js` or tenant data, it lives under `middleware-platform/scripts/`. If it orchestrates the whole monorepo or deploy targets, it lives under repo `scripts/`.
