# CMS-authoritative payor track — operator runbook

**Architecture + completion summary:** [`PAYOR_ARCHITECTURE_AND_ENTITY_RESOLUTION.md`](./PAYOR_ARCHITECTURE_AND_ENTITY_RESOLUTION.md) (implementation status, doc map, Section 12 provider network). **Detailed checklist:** [`../../todos/pending/PAYOR_ENTITY_RESOLUTION_TODOS.md`](../../todos/pending/PAYOR_ENTITY_RESOLUTION_TODOS.md).

Use this when Office Ally / Inovalon exports are **not** loaded yet. Free sources: CMS MA artifacts, NPPES dissemination (`npidata_pfile`, `endpoint_pfile`), NUCC, tier-1 pulls.

## 0. Current completed state (2026-04-26)

These are already implemented and validated:

- `run-payor-pbp-benefits-ingest.cjs` (benefits layer)
- `run-payor-landscape-premium-ingest.cjs` (premium layer)
- `run-payor-service-area-ingest.cjs` (county service area)
- `run-payor-zip-county-crosswalk-ingest.cjs` (ZIP eligibility bridge)
- `GET /api/public/plans/search` (ZIP + needs + sort -> explainable plan cards)

## 1. One SQLite file

1. `cd middleware-platform`
2. Set **`DB_PATH`** (or rely on default `middleware-dev.db` under the package) for **every** command in one session: `migrate`, imports, normalization, blocking, reports.
3. Confirm path in logs (`📁 Database path:` on server load), **`npm run verify:payor:sqlite-context`** (JSON: `sqlite_path`, `db_path_env`, `nppes_bulk_csv`, row counts), **`npm run report:payor:ops`** (`sqlite_path`, `db_path_env`), and stderr banners from **`npm run import:payor:nppes-bulk`** / **`npm run run:payor:cms-pipeline`**.
4. After vendor ingests: **`npm run verify:payor:vendor-env`** — reminds you to clear `cms_only` waivers when OA + Inovalon batches exist.

## 2. Readiness (Step 0–2)

Until vendor files exist, set in **`.env`** (and keep in sync for **staging / production** secret stores):

- `PAYOR_READINESS_VENDOR_MODE=cms_only` **or** `PAYOR_CMS_AUTHORITATIVE_TRACK_ONLY=1`

### Who flips it back (owner)

| Phase | Action | Owner (assign in your org) |
|--------|--------|------------------------------|
| Before OA/Inovalon files | Keep **`cms_only`** (or **`PAYOR_CMS_AUTHORITATIVE_TRACK_ONLY=1`**) so `report:payor:readiness:step0-2` passes without fake vendor data. | **Data / payor pipeline owner** (default: whoever owns NPPES + procurement). |
| After both vendors ingested | Run **`npm run import:payor:office-ally`** and **`npm run import:payor:inovalon`**, then **remove** the two env lines (or set `PAYOR_READINESS_VENDOR_MODE=` empty). Run **`npm run verify:payor:vendor-env`** — it should warn if batches exist but waivers are still on. | Same owner + **release sign-off** on the PR that enables strict gates. |
| Production cutover | Document the change in deploy notes / `EDGE_ROUTING_CONFIGS`-style runbook so the next engineer knows vendor gates are active. | **On-call / SRE** or release manager. |

Run: `npm run report:payor:readiness:step0-2`

## 3. Ingest metrics (optional)

- **`PAYOR_INGEST_METRICS_LOG_PATH`** — append one JSON line per payor ingest batch (`emitIngestMetrics`; includes optional **`routed_*`** / **`skipped_null_identity`** when the importer supplies them). Rotate or ship the file with your log agent (e.g. tail → Datadog Agent file tailer).
- **`PAYOR_INGEST_METRICS_WEBHOOK_URL`** — HTTP POST the same JSON payload (async, 8s timeout). Use a Datadog **Logs HTTP intake**, Slack incoming webhook, or internal collector URL.

**Sanity:** after a run, confirm lines appear for `event: payor_ingest_batch_completed` and (after code path runs) audit-backed routing appears under **`npm run report:payor:ops`** → **`metrics.ingest_routing`**.

## 4. CMS pipeline order (§13)

### One command (no Office Ally / Inovalon)

Runs migrate → tier-1 pull → NPPES Type 2 bulk → directory → FHIR endpoints → normalization dictionaries seed → normalization (`--until-done`) → blocking → fuzzy → resolution → canonicalization → readiness + ops reports.

**If you already ingested** `import:payor:nppes-bulk` and `import:nppes-endpoints` manually, do **not** re-run those steps: use **`npm run run:payor:nppes-path-b-pipeline -- --skip-migrate --skip-pull`** (wraps the same skips), or `npm run run:payor:cms-pipeline -- --skip-nppes-bulk --skip-directory --skip-endpoints`, or `npm run run:payor:cms-er-replay`. **Greenfield:** **`npm run run:payor:nppes-path-a`** after linking NPPES = verify + full pipeline. Full operator paths: **`todos/pending/PAYOR_ENTITY_RESOLUTION_TODOS.md`** §13 *Full NPPES bulk on disk — correct operator sequence*.

```bash
npm run run:payor:cms-pipeline
```

Optional flags: `--skip-migrate`, `--skip-pull`, `--skip-nppes-bulk`, `--skip-directory`, `--skip-endpoints`, `--skip-seed-dict`, `--skip-normalize`, `--skip-blocking`, `--skip-fuzzy`, `--skip-resolution`, `--skip-canonicalization`, `--skip-readiness`, `--skip-ops`. Tuning: `--nppes-bulk-limit=N`, `--norm-limit=5000`, `--norm-source=nppes_bulk`.

When exports exist later: `npm run import:payor:office-ally` and `npm run import:payor:inovalon` (not part of this chain).

### Same steps manually

1. `npm run migrate`
2. `npm run pull:payor:tier1`
3. `npm run import:payor:nppes-bulk` (same `DB_PATH`)
4. `npm run import:nppes-directory` or `npm run nppes:import-full`
5. `npm run import:nppes-endpoints`
6. `npm run run:payor:normalization -- --until-done --source=nppes_bulk --limit=5000` → blocking → fuzzy → resolution scripts as documented → `npm run report:payor:ops`

## 4b ER-only replay (after data is already in SQLite)

Re-run normalization through reports **without** migrate / tier-1 / CSV imports:

```bash
npm run run:payor:cms-er-replay
```

Same skip/limits as the full CMS pipeline tail (`--norm-limit=`, `--norm-source=`, `--skip-readiness`, etc.).

## 5. Ops report — CMS baseline block

When **`PAYOR_OPS_BASELINE_MODE=cms_only`** or the same readiness env flags as §2 are set, `report:payor:ops` adds **`baseline_cms_authoritative`** with gates on `nppes_bulk` raw + normalized counts.

- **`PAYOR_OPS_CMS_MIN_NPPES_BULK_RAW`** — optional floor (default `0` = informational).
- **`PAYOR_OPS_STRICT_BASELINE=1`** — AND baseline gates into overall `pass`, including doc floor **1000** raw `nppes_bulk` rows.
- **`metrics.ingest_routing`** — latest **`payor_ingest_routing_summary`** audit payloads per source (`routed_provider_rows`, `routed_payor_rows`, `skipped_null_identity`, etc.). **`PAYOR_OPS_ROUTING_STRICT=1`** — AND `ingest_routing.pass_soft` into overall `pass` (flags odd nppes_bulk / Inovalon routing patterns).

See `docs/Payor/PRODUCTION_READINESS_BASELINE.md` (CMS-authoritative section).

## 6. Provider network drift (Section 12 / QA)

On a **disposable** or test database:

```bash
npm run seed:provider:network-drift-test-data
npm run report:provider:network-drift-quality
```

Seeded rows intentionally fail the quality report until linker/cleanup rules are validated. For automated checks: `npm run test:provider:network-drift-quality` (Jest: `__tests__/provider-network-drift-quality-service.test.js`).

## 7. Runtime flags (eligibility / claims)

- `PAYOR_CANONICAL_RESOLVER_ENABLED` / `PAYOR_CANONICAL_RESOLVER_SHADOW`
- `PROVIDER_NETWORK_PRECHECK_ENABLED` / `PROVIDER_NETWORK_PRECHECK_SHADOW`  
  Empty **`provider_payer_networks`** → precheck **`no_network_data`** (see `.env.example`).

## 8. Product rollout checklist (§14.G — not automated here)

Use this when moving from “pipeline works in dev” to **production**.

1. **Review queue (Step 7)** — Exercise **`GET/POST /api/admin/payor-review-queue*`** in staging; define who triages `pending` rows and SLA (UX can follow in the admin app).
2. **Canonical resolver** — Enable **`PAYOR_CANONICAL_RESOLVER_SHADOW=1`** in staging first; compare logs; then **`PAYOR_CANONICAL_RESOLVER_ENABLED=1`** for a canary clinic or low-traffic window; roll forward / revert via env only.
3. **Provider network precheck** — Same pattern: **`PROVIDER_NETWORK_PRECHECK_SHADOW=1`** → **`PROVIDER_NETWORK_PRECHECK_ENABLED=1`** when `provider_payer_networks` has trustworthy coverage.
4. **Hosted metrics** — Point **`PAYOR_INGEST_METRICS_WEBHOOK_URL`** (and optional log tailer on **`PAYOR_INGEST_METRICS_LOG_PATH`**) at your observability stack; save dashboard links and “who pages” in your team runbook (outside this repo if preferred).

**Regression bundle (provider + payor smoke):** `npm run test:payor:section14-smoke` (Jest, in-band).

## 9. Consumer search data refresh sequence (new)

When refreshing MA consumer-search layers, run in this order (same `DB_PATH`):

1. `run-payor-pbp-benefits-ingest.cjs`
2. `run-payor-landscape-premium-ingest.cjs`
3. `run-payor-service-area-ingest.cjs`
4. `run-payor-zip-county-crosswalk-ingest.cjs`

Then validate one end-to-end query:

- Input: ZIP + needs (for example `33101`, `dental,hearing`)
- Output: plans include premium, stars, MOOP, need coverage signals.
