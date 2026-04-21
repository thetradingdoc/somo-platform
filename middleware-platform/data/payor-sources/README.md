# Payor raw data layout

Keep CMS and vendor bulk files under this tree so scripts do not depend on arbitrary paths (for example `~/Downloads`).

| Path | Contents |
|------|-----------|
| `nppes/` | NPPES dissemination zip and/or extracted `NPPES_Data_Dissemination_*_V2` folder (`npidata_pfile_*.csv`) |
| `office-ally/` | Office Ally export files (when available) |
| `inovalon/` | Inovalon export files (when available) |

**Link an existing NPPES folder** (one-time per machine):

```bash
cd middleware-platform
npm run setup:payor-data-sources:link-nppes -- /absolute/path/to/NPPES_Data_Dissemination_April_2026_V2
```

Override the root directory with **`PAYOR_DATA_SOURCES_ROOT`** (absolute or relative to `middleware-platform/`). Optional: **`NPPES_DISSEMINATION_DIR`**, **`NPPES_NPIDATA_CSV`**, **`NPPES_ENDPOINT_CSV`**, **`NPPES_ZIP_PATH`** for `nppes:import-full`.

After linking NPPES, load FHIR endpoints into SQLite:

```bash
npm run import:nppes-endpoints
```

**One-command paths** (from `PAYOR_ENTITY_RESOLUTION_TODOS.md` §13; run inside `middleware-platform/`):

| Script | What it does |
|--------|----------------|
| `npm run run:payor:nppes-path-a` | `verify:payor:sqlite-context` then full `run:payor:cms-pipeline` (link/env first). |
| `npm run run:payor:nppes-path-b-pipeline -- --skip-migrate --skip-pull` | Full pipeline **without** re-importing bulk/directory/endpoints (after those are already loaded). |
| `npm run run:payor:nppes-path-c-manual` | ER-only: normalization → blocking → fuzzy → resolution → canonicalization → `report:payor:ops`. |

Tier-1 CMS MA pulls also mirror **`ma-plan-directory.html`** and **`ma-plan-directory.zip`** into `data/payor-sources/cms/` when `pull:payor:tier1` runs.

This directory is gitignored except for this README.
