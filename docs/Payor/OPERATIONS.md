# OPERATIONS

**Last updated:** 2026-06-02


---

<a id="payor-architecture-and-entity-resolution"></a>

## PAYOR ARCHITECTURE AND ENTITY RESOLUTION

*Merged from `docs/Payor/PAYOR_ARCHITECTURE_AND_ENTITY_RESOLUTION.md` on 2026-06-02.*

# Payor Architecture and Entity Resolution Plan

## Purpose

This document captures:

1. The current payor/payer architecture in the platform.
2. How the **offline entity-resolution pipeline** (Steps 1–7) and **runtime integration** (Step 8) fit together.
3. **Provider registry and in-network precheck** (Section 12) adjacent to payor ER.
4. What remains **procurement-, rollout-, or product-dependent** (vendor files, hosted dashboards, review UX).

The objective is to move from basic payer lookup/caching to a canonical, pre-resolved payor registry that supports sub-millisecond runtime lookup for claim-time operations.

### Related documents

| Document | Role |
|----------|------|
| [`PAYOR_CMS_TRACK_RUNBOOK.md`](./PAYOR_CMS_TRACK_RUNBOOK.md) | Operator order: `DB_PATH`, CMS-only readiness, metrics, pipeline, ER replay, provider-network drift QA, **§8 product rollout** |
| [`PRODUCTION_READINESS_BASELINE.md`](./PRODUCTION_READINESS_BASELINE.md) | First-run / CMS-authoritative pass thresholds |
| [`PAYOR_SOURCE_CONTRACTS.md`](./PAYOR_SOURCE_CONTRACTS.md) | Source cadence, ownership, schema drift |
| [`PROVIDER_NETWORK_INGESTION_CONTRACTS.md`](./PROVIDER_NETWORK_INGESTION_CONTRACTS.md) | Network evidence → `provider_payer_networks` |
| [`PAYOR_DEFERRED_THIRD_PARTY_DATASETS.md`](./PAYOR_DEFERRED_THIRD_PARTY_DATASETS.md) | Explicit non-imports (companion NPPES files, etc.) |
| [`PAYOR_NAMING_CONVENTION.md`](./PAYOR_NAMING_CONVENTION.md) | `payor` vs `payer` |
| [`PAYOR_ENTITY_RESOLUTION_TODOS.md`](../../todos/pending/PAYOR_ENTITY_RESOLUTION_TODOS.md) | Detailed checklist (Steps 0–14) |

### Implementation status (latest architecture snapshot)

### Latest completed milestone (2026-04-26)

The platform now supports a full public-data MA search chain:

1. **Benefits layer loaded** from CMS PBP:
   - `payor_plan_benefits` populated via `run-payor-pbp-benefits-ingest.cjs` (v3 logic with `covered_source`).
2. **Premium layer loaded** from CMS Landscape:
   - `payor_plan_premiums` populated via `run-payor-landscape-premium-ingest.cjs`.
3. **Service area + ZIP eligibility loaded**:
   - `payor_plan_service_areas` via `run-payor-service-area-ingest.cjs`
   - `zip_county_crosswalk` via `run-payor-zip-county-crosswalk-ingest.cjs`
4. **Consumer search API added**:
   - `GET /api/public/plans/search` (`routes/public-plan-search.js`)
   - input: `zip`, `needs[]`, `sort_by`
   - output: plan cards with premium, stars, MOOP, matched/unmatched needs, reasons, warnings, coverage detail, confidence.

**Operational stopgap:** ZIP `33101` is temporarily state-filtered to `FL` in the route to prevent county crosswalk bleed while broader ZIP/county disambiguation is tuned.

**Offline payor ER (Steps 1–7)** — **Implemented** in SQLite (`middleware-platform/database.js` + migrations), with services and scripts: raw ingest (`payor_source_records`, `payor_ingest_batches`), normalization (`payor-normalization-service`), blocking (`payor-blocking-service`), fuzzy scoring (`payor-fuzzy-match-service`), composite decisions (`payor-resolution-scoring-service` / policy tables), canonical entities (`payor_canonical_entities`, aliases, links, relationships), and review queue tables + **admin APIs** (`/api/admin/payor-review-queue*`). Contamination guardrails (e.g. MA directory excluded from blocking, ingest routing split for Type 1 vs Type 2 NPPES) are in place per `PAYOR_ENTITY_RESOLUTION_TODOS.md` §9.1.

**Runtime (Step 8)** — **`payor-registry-resolver-service.js`** resolves payer text to canonical ids on insurance paths behind **`PAYOR_CANONICAL_RESOLVER_ENABLED`** / **`PAYOR_CANONICAL_RESOLVER_SHADOW`** (no claim-time fuzzy matching).

**Provider registry & networks (Section 12)** — Schema and services for **`provider_registry_entities`**, taxonomies, **`provider_payer_networks`**, search (`provider-search-service`, `GET /api/provider-registry/search`), network ingest/linker scripts, drift/quality reports, and **in-network precheck** (`provider-network-precheck-service`) behind **`PROVIDER_NETWORK_PRECHECK_*`**. Empty network table → explicit **`no_network_data`** / unknown semantics (see tests).

**CMS-authoritative track** — Single orchestrated path: **`npm run run:payor:cms-pipeline`**; replay without re-ingest: **`npm run run:payor:cms-er-replay`**; ops/readiness: **`npm run report:payor:ops`**, **`npm run report:payor:readiness:step0-2`**. Until vendor files exist, **`PAYOR_READINESS_VENDOR_MODE=cms_only`** or **`PAYOR_CMS_AUTHORITATIVE_TRACK_ONLY=1`** waives Office Ally / Inovalon gates (see runbook §2).

**Verification** — **`npm run verify:payor:sqlite-context`**, **`npm run verify:payor:vendor-env`**; bundled regression: **`npm run test:payor:section14-smoke`** (provider dedup/search, network linker/drift/precheck, payor unit tests).

**Operator shortcuts (full NPPES / §13)** — **`npm run run:payor:nppes-path-a`** (verify then full CMS pipeline), **`npm run run:payor:nppes-path-b-pipeline`** (pipeline without re-importing bulk/directory/endpoints; pass `-- --skip-migrate` etc.), **`npm run run:payor:nppes-path-c-manual`** (ER-only chain).

**Not implied by code alone**

- **Production vendor files** — Office Ally / Inovalon importers exist; **filling** `DB_PATH` with customer exports is procurement (see todos §1.A, §13).
- **Hosted metrics dashboards** — Optional **`PAYOR_INGEST_METRICS_LOG_PATH`** / **`PAYOR_INGEST_METRICS_WEBHOOK_URL`** emit payloads; dashboard wiring and on-call ownership live outside this repo unless your team adds them (runbook §3, §8).
- **Product rollout** — Resolver and precheck **shadow → enable**, review queue triage SLA, and production flag timing: **runbook §8** checklist; todos §11 / §14.G.
- **Deeper test matrix** — Scripted E2E ingest→canonical runs, golden payer datasets, and performance budgets: partially open (todos §10).

## Naming Convention Decision

- Canonical term for new ER work: `payor`
- Compatibility term for existing runtime/system surfaces: `payer`
- Decision record: `docs/Payor/PAYOR_NAMING_CONVENTION.md`

### Canonical payor data directory (NPPES, Office Ally, Inovalon)

All large **raw** inputs should resolve under one tree so paths are not scattered (for example under `~/Downloads`).

- **Default root:** `middleware-platform/data/payor-sources/` (override with **`PAYOR_DATA_SOURCES_ROOT`**).
- **NPPES:** place the extracted dissemination folder **`NPPES_Data_Dissemination_*_V2`** under `…/nppes/`, or symlink it with  
  `npm run setup:payor-data-sources:link-nppes -- /absolute/path/to/NPPES_Data_Dissemination_April_2026_V2`  
  so `npidata_pfile_*.csv` is discoverable next to future **`office-ally/`** and **`inovalon/`** drops.
- **Resolution:** `import-nppes-directory`, `import:payor:nppes-bulk`, `import:nppes-endpoints`, and `nppes:import-full` use `scripts/payor-data-sources.cjs` when no explicit CSV path is passed. Optional overrides: **`NPPES_DISSEMINATION_DIR`**, **`NPPES_NPIDATA_CSV`**, **`NPPES_ENDPOINT_CSV`**.
- **GCP:** optional **`PAYOR_RAW_GCS_*`** upload is an artifact mirror; it does not replace this on-disk layout for local ingest.

### NPPES `source` labels and CMS MA vs payer ER blocking

- **`nppes_bulk`** — Row-level **organization (Type 2)** records from `import-payor-nppes-bulk.cjs`; participates in payer ER blocking (when normalized).
- **`nppes_bulk_artifact`** — Single **tier-1 pull** row pointing at the downloaded NPPES zip (provenance only). Excluded from blocking via `PAYER_ER_EXCLUDED_SOURCES` so it is never treated as a payer candidate.
- **`cms_ma_plan_directory` / `cms_ma_plan_directory_page`** — Ingested for MA plan metadata, but **excluded from payer ER blocking** (`PAYER_ER_EXCLUDED_SOURCES`) because directory rows are poor cross-source blocking keys and skew pair generation; they remain available for other analytics or future filtered use.

### NPPES FHIR endpoints (`endpoint_pfile`)

- Ingest: **`npm run import:nppes-endpoints`** → table **`nppes_fhir_endpoints`** (NPI, endpoint URL, use/content-type, affiliation fields). Same dissemination folder as `npidata` when using canonical paths.
- **Other companion files** (`pl_pfile`, `othername_pfile`, …) are not ingested unless we add explicit contracts.

### Payor ingest metrics (optional)

- Set **`PAYOR_INGEST_METRICS_LOG_PATH`** to a file path; `emitIngestMetrics` appends one JSON line per payor ingest batch completion (console logging unchanged).
- Optional **`PAYOR_INGEST_METRICS_WEBHOOK_URL`**: same payload POSTed asynchronously (wire to Datadog HTTP intake, Cloud Run, etc.).

### Readiness: vendor vs CMS-only

- `npm run report:payor:readiness:step0-2` — by default expects **Office Ally + Inovalon** ingest batches.
- **CMS-only / no vendor files yet:** set **`PAYOR_READINESS_VENDOR_MODE=cms_only`** or **`PAYOR_CMS_AUTHORITATIVE_TRACK_ONLY=1`** so those gates are **waived** and reported explicitly (overall `pass` uses non-waived gates only).
- **End-to-end CMS ingest + ER (no Ally/Inovalon):** `npm run run:payor:cms-pipeline` — see **`docs/Payor/PAYOR_CMS_TRACK_RUNBOOK.md`**.
- **ER-only replay (data already ingested):** `npm run run:payor:cms-er-replay` — normalization through **`report:payor:ops`**; ingest routing sanity lives under **`metrics.ingest_routing`** in that report.
- **Regression bundle (readiness + provider network + payor ER Jest):** `npm run test:payor:section14-smoke`.

---

## Current Architecture (As-Is)

### 1) Data Store and Core Tables

The middleware currently uses SQLite as the default operational database (`middleware-platform/database.js`), with WAL mode and busy timeout enabled for concurrency reliability.

Insurance/payer-related tables already present:

- `insurance_payers`
  - `payer_id` (unique), `payer_name`, `aliases`, `supported_transactions`, status/timestamps.
- `patient_insurance`
  - patient-linked payer/member details.
- `eligibility_checks`
  - eligibility request/response snapshots by payer/member/service.
- `insurance_claims`
  - claim lifecycle records keyed to payer/member/service.

**Augmented by payor ER tables** — `payor_source_records`, `payor_canonical_entities`, aliases, links, etc. (see **Implementation status**). The legacy tables above remain the Stedi-facing cache and transaction history.

### 2) Service Layer

Current payer-adjacent services:

- `insurance-service.js`
  - Integrates with Stedi for eligibility (270/271), claims (837), claim status (276/277), and payer directory fetch.
- `payer-cache-service.js`
  - Caches payers in `insurance_payers`.
  - Supports `searchPayer`, `getPayerById`, `validatePatientInsurance`, `syncPayerList`.
- `payer-gateway-service.js`
  - Routes payer operations across backends (`stedi`, `uhc_fhir`, `stedi+uhc_fhir`) based on payer and credential availability.

### 3) API Surface

Admin APIs currently available in `server.js`:

- `GET /api/admin/insurance/payers`
- `GET /api/admin/insurance/payers/search`
- `POST /api/admin/insurance/sync-payers`
- `GET /api/admin/insurance/payers/stats`

**Additionally (payor ER + review):** `GET` / `POST` **`/api/admin/payor-review-queue*`** for canonicalization review; **provider registry:** **`GET /api/provider-registry/search`**. Offline ingest and resolution run via **npm scripts** (`run:payor:cms-pipeline`, etc.), not only through the legacy payer cache APIs.

### 4) Matching Logic — legacy cache vs canonical ER

**Legacy `searchPayer` / insurance admin search** remains lightweight:

- SQL `LIKE` over `payer_name` and serialized `aliases`.

**Canonical payor ER (offline)** uses normalization, blocking, fuzzy scores, and policy thresholds on **`payor_source_records`** → **`payor_canonical_entities`** (see **Implementation status** above). Runtime paths use **`payor-registry-resolver-service`** against the canonical alias index when flags are enabled, not inline fuzzy matching on the request.

### 5) Existing Architecture Patterns We Can Reuse

The repository already has reusable patterns relevant to payor ER:

- Canonical identity concepts (`empi_persons`, `empi_links`) for patients.
- Review queue and reviewer actions (`patient_merge_events` + dashboard review UI) that can be adapted for payor match review.
- Migration style in `database.js` suited for incremental schema rollout.

---

## Historical gaps vs remaining work

The following described **early-2025 design gaps**. The **offline ER pipeline and canonical tables now address A–F** for payor-specific data; legacy **`insurance_payers`** remains the Stedi/cache surface while **`payor_canonical_entities`** and links hold the resolved graph.

| Original gap | Status |
|--------------|--------|
| **A** Multi-source raw ingest | **Addressed** — `payor_source_records`, `payor_ingest_batches`, vendor + CMS importers |
| **B** Normalization | **Addressed** — `payor_normalized_records`, dictionary tables, `payor-normalization-service` |
| **C** Blocking | **Addressed** — `payor_match_candidates`, `payor-blocking-service` |
| **D** Fuzzy + weighted scoring | **Addressed** — `payor_similarity_scores`, resolution policy + decisions |
| **E** Canonical entity model | **Addressed** — `payor_canonical_entities`, aliases, links, relationships |
| **F** Payor review queue | **Addressed** — tables + APIs; **UX polish and workflows** still evolve (todos §11) |

**Still true at the edges**

- **`insurance_payers`** is not fully replaced as the only runtime surface; gateway/Stedi integration still uses cached payer ids where not yet bridged.
- **Coverage and quality** depend on **which sources are loaded** (national NPPES Type 2 volume, vendor files when available).
- **Provider network “accepts plan X”** requires **network source ingestion** into `provider_payer_networks`, not automatic from NPPES alone.

---

## Proposed updates (design reference)

The subsections below describe the **7-step offline pipeline** design. **Implementation** aligns with these steps; see **Implementation status** above and **`PAYOR_ENTITY_RESOLUTION_TODOS.md`** for line-by-line completion.

## Degraded Mode Rollout Note

Current rollout can proceed in degraded mode when Office Ally source exports are unavailable.

- Enabled ingest sources in degraded mode: `inovalon`, `nppes_bulk`, `nppes_api`, `nucc_csv`, `cms_ma_plan_directory`.
- Blocked source: `office_ally` (must remain explicitly marked unavailable until valid production export is provided).
- Runtime impact: lookup quality and latency can still improve materially, but final payer coverage/completeness is lower than full-source mode.
- Guardrail: strict readiness report must continue to fail Office Ally-specific gates while source is unavailable (no silent pass).
- Step 3+ requirement: output source-level coverage metrics so degraded-mode impact is quantified over time.

### Current ER Blocking Scope Guardrail (Implemented)

To prevent provider-taxonomy/reference contamination in payer ER candidate generation, Step 3 blocking excludes these sources at scope time:

- `nucc_csv`
- `nucc`
- `nucc_taxonomy`
- `cms_ma_plan_directory`
- `cms_ma_plan_directory_page`

Result: payer ER candidate generation runs only on payer-appropriate sources in degraded mode (for example `nppes_api`, `nppes_bulk`, plus Office Ally/Inovalon when available).

### Step 1 - Raw Ingest

Add source-stamped raw ingest tables for Office Ally, Inovalon, CMS, NUCC, and future feeds.

Recommended additions:

- `payor_source_records`
  - source name, source record ID, raw payor name, raw structured IDs (payer_id/npi/ein), payload JSON, ingest batch/version.
- `payor_ingest_batches`
  - file/batch metadata, timestamps, counts, checksums.

Outcome: complete auditability and replay capability for ingest runs.

### Step 2 - Deterministic Normalization

Create a reusable normalizer module with consistent transforms:

1. lowercase
2. strip punctuation
3. expand known abbreviations
4. remove stopwords (`insurance`, `company`, `inc`, `llc`, `of`, `the`, etc.)
5. extract state suffix (`of ohio` -> state=`OH`)
6. derive phonetic/block keys (soundex/metaphone-like key)

Recommended tables:

- `payor_abbreviation_dictionary`
  - `abbr`, `expanded_form`, `confidence`, `active`.
- `payor_normalized_records`
  - foreign key to source record + normalized fields + derived keys.

Outcome: deterministic comparability before any fuzzy logic.

### Step 3 - Blocking

Generate candidate pairs using multiple parallel blocking keys:

- exact payer ID
- exact NPI
- exact EIN (if present)
- soundex first token
- normalized prefix key

Recommended table:

- `payor_match_candidates`
  - left/right record IDs, block key type, block key value, generation batch.

Outcome: massive reduction in comparison volume.

### Step 4 - Fuzzy Matching

For candidate pairs, compute multiple string similarity signals (rapidfuzz in Python worker or equivalent JS implementation):

- Jaro-Winkler (typos/spacing)
- token sort ratio (word order changes)
- token set ratio (subset relationships)

Store each subscore and metadata for explainability.

Recommended table:

- `payor_similarity_scores`
  - candidate ID + algorithm-specific scores + scoring version.

### Step 5 - Composite Scoring and Threshold Policy

Build weighted confidence score, for example:

- NPI exact: 0.40
- payer ID exact: 0.30
- fuzzy agreement: 0.20
- penalties: state/plan divergence

Threshold policy:

- `>= 0.90`: auto-merge
- `0.70-0.89`: merge candidate, flag for review
- `< 0.70`: human-candidate/no merge
- `< 0.40`: distinct entities

Recommended table:

- `payor_resolution_decisions`
  - final score, decision class, reason codes, scoring policy version.

### Step 6 - Canonical Record Construction

Build canonical entities with field-level source precedence:

- official name and payer ID prioritize CMS/authoritative source
- routing details prioritize clearinghouse source when applicable
- retain all aliases for runtime lookup
- preserve subsidiaries/state variants as related-but-distinct where needed

Recommended tables:

- `payor_canonical_entities`
- `payor_entity_aliases`
- `payor_entity_links` (source record -> canonical entity)
- `payor_entity_relationships` (parent/subsidiary/state variant)

Outcome: stable pre-resolved registry for claim-time `SELECT` lookup.

### Step 7 - Human Review Queue and Learning Loop

Add lightweight review workflow for ambiguous cases:

- queue unresolved/low-confidence candidate pairs
- allow reviewer actions: merge / keep separate / related subsidiary
- store decision rationale
- feed decisions back into threshold tuning and optional classifier training

Recommended tables:

- `payor_review_queue`
- `payor_review_decisions`

Outcome: continuous precision improvement and reduced manual review over time.

---

## Implemented Additions Beyond Step 7

### Runtime Canonical Resolver (Step 8)

Implemented in runtime insurance flows:

- `PUT /api/patient/insurance`
- `POST /voice/insurance/check-eligibility`
- `POST /voice/insurance/submit-claim`

Feature flags:

- `PAYOR_CANONICAL_RESOLVER_ENABLED`
- `PAYOR_CANONICAL_RESOLVER_SHADOW`

### Provider Registry and Network Linkage (Section 12)

Implemented assets:

- Provider registry schema:
  - `provider_registry_entities`
  - `provider_registry_source_links`
  - `provider_registry_aliases`
  - `provider_taxonomy_links`
  - `provider_network_source_records`
  - `provider_payer_networks`
- NPI-first provider dedup script:
  - `scripts/run-provider-registry-npi-dedup.cjs`
- Provider specialty search service + endpoint:
  - `services/provider-search-service.js`
  - `GET /api/provider-registry/search`
- Network evidence parser + linker:
  - `scripts/import-provider-network-evidence.cjs`
  - `scripts/run-provider-network-linker.cjs`
- Drift/quality and consistency reports:
  - `scripts/report-provider-network-drift-quality.cjs`
  - `scripts/report-provider-network-consistency.cjs`

### Conflict Resolution Policy (Implemented + Test-Locked)

For provider-payor network status conflicts on the same pair:

1. Higher `confidence` wins.
2. If confidence ties, newer `effective_start_date` wins.
3. Conflicting status variants are still surfaced in drift reporting.

Regression tests:

- `__tests__/provider-network-linker-conflict.test.js`
- `__tests__/provider-registry-dedup.test.js`
- `__tests__/provider-search-service.integration.test.js`

### First Real-Run Baseline Gate

Production pass/fail thresholds are defined in:

- `docs/Payor/PRODUCTION_READINESS_BASELINE.md`

This baseline must be used for first unrestricted ingest validation before claiming readiness.

### Regression and smoke bundle

- **`npm run test:payor:section14-smoke`** — Jest bundle: provider dedup, search integration, network linker conflict, drift quality, precheck, payor resolver, and `payor-*.test.js` units (see `middleware-platform/package.json`).

Operator checklist for env flags and staged rollout: **`PAYOR_CMS_TRACK_RUNBOOK.md` §7–§8**.

---

## Runtime Contract (Critical)

Entity resolution runs offline on a schedule (nightly or batch-triggered). Runtime claim/eligibility flows should not perform fuzzy matching in-line.

Runtime flow should be:

1. normalize incoming payer text quickly,
2. lookup in canonical alias index,
3. return canonical payor entity ID and authoritative payer routing fields.

This protects latency and reliability in claim-time paths.

---

## Suggested rollout plan (status)

| Phase | Intent | Status |
|-------|--------|--------|
| **1 — Foundation** | Raw ingest + normalization + abbreviation seed | **Shipped** (scripts + tables) |
| **2 — Matching core** | Blocking + fuzzy + composite decisions | **Shipped** |
| **3 — Canonical registry** | Canonical entities + alias index + bridge from `insurance_payers` | **Shipped** |
| **4 — Review + governance** | Review queue APIs + evidence; reviewer actions | **Shipped** (APIs); **UI/UX iteration** ongoing |
| **5 — Production hardening** | Metrics, quality gates, ops reports, baseline docs | **Shipped** in repo; **hosted dashboards** and org-specific SLAs are external |

**Follow-on (not sequential phases)** — Provider registry + network linkage (§12); CMS-orchestrated pipeline + ER replay; vendor ingests when files arrive. See todos §12–§14.

---

## Open decisions

1. **Field-level precedence** — CMS vs clearinghouse vs Stedi for specific routing fields is partially encoded in canonicalization; extend the matrix as new sources land.
2. **Fuzzy worker** — **Node** scorers are canonical; Python `rapidfuzz` sidecar **deferred** (todos §4).
3. **Review SLA and ownership** — Operational (assign in runbook §2 / §8); not enforced in code.
4. **`insurance_payers` bridge** — Backfill/bridge paths exist; long-term single source of truth for runtime ids may still co-evolve with Stedi.

---

## Summary

The platform combines **legacy payer cache and transactions** (`insurance_payers`, Stedi/gateway) with a **canonical payor entity-resolution pipeline** (offline Steps 1–7), **runtime resolver** (Step 8), and **provider registry + network precheck** (Section 12). National-scale **quality** depends on loaded sources (especially NPPES Type 2 volume and optional vendor exports). **Production rollout** of flags, metrics sinks, and review workflows is documented in **`PAYOR_CMS_TRACK_RUNBOOK.md`**; **`PAYOR_ENTITY_RESOLUTION_TODOS.md`** tracks remaining procurement and test-matrix items.

As of the latest update, the stack also includes a launchable MA discovery layer: **ZIP availability + premium + benefit fit** served from SQLite via `/api/public/plans/search`.


---

<a id="payor-source-contracts"></a>

## PAYOR SOURCE CONTRACTS

*Merged from `docs/Payor/PAYOR_SOURCE_CONTRACTS.md` on 2026-06-02.*

# Payor Source Contracts (Step 1)

## Purpose

Define minimum operational contracts for each raw source so ingest is repeatable, owned, and resilient to schema drift.

## Source Contracts

- **CMS Landscape Source File (CY2026)**
  - Refresh cadence: monthly or when CMS republishes landscape snapshot.
  - Owner: Middleware platform ingestion job owner.
  - Delivery contract: `cy2026-landscape-202603.zip` archived under `~/payor-data/landscape-2026/...`.
  - Ingest target: `payor_plan_premiums` via `run-payor-landscape-premium-ingest.cjs`.
  - Schema drift policy: fail ingest when core identity/price fields are missing (`Contract ID`, `Plan ID`, premium columns).

- **CMS MA Contract Service Area (State/County)**
  - Refresh cadence: monthly.
  - Owner: Middleware platform ingestion job owner.
  - Delivery contract: monthly ZIP (for example `ma-contract-service-area-state-county-april-2026.zip`) archived under `~/payor-data/service-area-2026/...`.
  - Ingest target: `payor_plan_service_areas` via `run-payor-service-area-ingest.cjs`.
  - Schema drift policy: fail when `Contract ID`/`FIPS`/`State` missing; allow sparse optional columns.

- **Census ZIP -> County Crosswalk**
  - Refresh cadence: as Census relation files update.
  - Owner: Middleware platform ingestion job owner.
  - Delivery contract: `tab20_zcta520_county20_natl.txt` saved as `zip_county_crosswalk.txt`.
  - Ingest target: `zip_county_crosswalk` via `run-payor-zip-county-crosswalk-ingest.cjs`.
  - Schema drift policy: fail when ZIP or county FIPS columns are absent.

- **Office Ally**
  - Refresh cadence: weekly (or upon new export delivery).
  - Owner: Middleware platform data ingestion owner.
  - Delivery contract: XLSX/CSV export to secure handoff location.
  - Schema drift policy: run header diff against prior batch; if new/removed key fields (`payer_name`, `payer_id`, `npi`, routing fields), open a blocking ingest review ticket before promoting.

- **Inovalon**
  - Refresh cadence: weekly (or upon new export delivery).
  - Owner: Middleware platform data ingestion owner.
  - Delivery contract: XLSX/CSV export to secure handoff location.
  - Schema drift policy: same header diff gate as Office Ally; block promotion if identity/routing fields drift.

- **CMS MA Plan Directory**
  - Refresh cadence: monthly (align with CMS publication updates).
  - Owner: Middleware platform ingestion job owner.
  - Delivery contract: pull machine-readable ZIP from CMS page and archive raw artifact to GCS.
  - Schema drift policy: parse delimited file with tolerant parser; if contract ID or organization name fields are missing, fail batch with error summary.

- **NPPES Bulk + API**
  - Refresh cadence: weekly bulk pull + daily seeded API snapshots.
  - Owner: Middleware platform ingestion job owner.
  - Delivery contract: bulk dissemination ZIP + controlled API queries (seed list strategy).
  - **Source labels:** tier-1 download registers one row as `nppes_bulk_artifact` (zip provenance only). Row-level org NPIs from `npidata_pfile_*.csv` use `nppes_bulk` (Entity Type 2 only) via `import:payor:nppes-bulk`.
  - Schema drift policy: if NPI/basic/address structures change, persist payload and route to parser update queue.

- **NPPES FHIR Endpoints (`endpoint_pfile_*.csv`)**
  - Refresh cadence: same as NPPES monthly dissemination.
  - Owner: Middleware platform ingestion job owner.
  - Delivery contract: file ships alongside `npidata` in `NPPES_Data_Dissemination_*_V2`; ingest to `nppes_fhir_endpoints` via `npm run import:nppes-endpoints` (auto path via `payor-data-sources.cjs` or `NPPES_ENDPOINT_CSV`).
  - Schema drift policy: tolerant CSV parse on quoted CMS headers; require non-empty `NPI` + `Endpoint`; unique `(npi, endpoint_url)`.

- **NUCC Taxonomy**
  - Refresh cadence: monthly check, ingest latest and available historical snapshots.
  - Owner: Middleware platform ingestion job owner.
  - Delivery contract: CSV links discovered on NUCC taxonomy page and archived to GCS.
  - Schema drift policy: tolerant CSV parse; if classification/specialization fields are absent, warn and flag for mapping update.

- **WEDI**
  - Refresh cadence: quarterly check for machine-readable artifacts.
  - Owner: Middleware platform ingestion job owner.
  - Delivery contract: currently reference-only metadata ingest.
  - Schema drift policy: if CSV/XLSX/ZIP links become available, promote source from reference-only to active machine ingest.

- **Provider Network Evidence (CMS MA Provider Directories)**
  - Refresh cadence: monthly (or weekly when CMS republishes).
  - Owner: Middleware platform ingestion job owner.
  - Delivery contract: CSV ingest into `provider_network_source_records` with NPI + payer hint hard requirements.
  - Schema drift policy: preserve unknown columns in provenance payload; fail only when required identity fields are missing.
  - Implementation reference: `docs/Payor/PROVIDER_NETWORK_INGESTION_CONTRACTS.md`.

Deferred datasets that are intentionally **not** ingested yet (NPPES companion files, non-NPPES CMS provider bulk) are summarized in `docs/Payor/PAYOR_DEFERRED_THIRD_PARTY_DATASETS.md`.

## Promotion Gate

Before Step 2 normalization:

1. Latest artifacts exist in GCS for all active sources.
2. Identifier coverage report generated (`NPI`, `payer_id`, `EIN`, `state_hint`).
3. Business-value field coverage report generated.
4. Any schema drift alerts resolved or explicitly waived with owner approval.

## Completed to date (2026-04-26)

The following source contracts are now implemented in code and exercised on live DB runs:

- CMS PBP benefits (`run-payor-pbp-benefits-ingest.cjs`)
- CMS Landscape premiums (`run-payor-landscape-premium-ingest.cjs`)
- CMS MA county service area (`run-payor-service-area-ingest.cjs`)
- Census ZIP/county crosswalk (`run-payor-zip-county-crosswalk-ingest.cjs`)

## Payer ER Scope Exclusions (Implemented)

The following sources may be ingested for provenance/reference use but are excluded from payer ER blocking/candidate generation:

- `nucc_csv`
- `nucc`
- `nucc_taxonomy`
- `cms_ma_plan_directory`
- `cms_ma_plan_directory_page`
- `nppes_bulk_artifact`

Reason: taxonomy/reference, MA directory row shape, or **artifact-only** provenance rows are poor payer ER blocking keys and cause candidate contamination when mixed into blocking scope. Row-level NPPES org data remains `nppes_bulk` (not excluded).


---

<a id="payor-naming-convention"></a>

## PAYOR NAMING CONVENTION

*Merged from `docs/Payor/PAYOR_NAMING_CONVENTION.md` on 2026-06-02.*

# Payor/Payer Naming Convention

## Decision

Use **`payor`** as the canonical term for new entity-resolution architecture, docs, and new schema artifacts.

Keep **`payer`** for existing runtime/API compatibility surfaces that are already in production.

## Why

- Business and ER documentation in this project is centered on "payor" as the strategic domain term.
- Existing implementation paths already expose "payer" names (`insurance_payers`, `payer_id`, service names, API routes).
- Forcing a hard rename now would create avoidable risk and migration churn before Step 2+ pipeline work.

## Compatibility Rule

- **New ER assets** (new docs, scripts, tables, jobs) should prefer `payor_*`.
- **Existing runtime assets** remain unchanged unless there is an explicit migration plan:
  - `insurance_payers`
  - existing `payer_*` columns
  - existing API route and service naming
- When a new payor pipeline component integrates with legacy runtime components, use explicit field mapping rather than rename-in-place.

## Practical Guidance

- Accept both incoming labels (`payor_name` and `payer_name`) at ingest boundaries.
- Normalize to the target table schema intentionally (do not assume one naming style across all modules).
- Document any future rename migration separately as a dedicated compatibility project.


---

<a id="payor-cms-track-runbook"></a>

## PAYOR CMS TRACK RUNBOOK

*Merged from `docs/Payor/PAYOR_CMS_TRACK_RUNBOOK.md` on 2026-06-02.*

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


---

<a id="payor-deferred-third-party-datasets"></a>

## PAYOR DEFERRED THIRD PARTY DATASETS

*Merged from `docs/Payor/PAYOR_DEFERRED_THIRD_PARTY_DATASETS.md` on 2026-06-02.*

# Deferred / out-of-scope payor-related datasets

This note closes the loop on sources that **ship with NPPES** or appear on **data.cms.gov** but are **not** loaded into the middleware SQLite payor ER tables today.

## Clarification: now in scope vs still deferred

Already in scope and implemented:

- CMS PBP benefits (2026)
- CMS Landscape premium file (2026)
- CMS MA Contract Service Area by State/County
- Census ZIP -> county crosswalk

Still deferred:

- Standalone dental/vision plan datasets
- Medigap/supplement-specific datasets
- Medicaid and commercial plan datasets outside current MA/PDP track

## NPPES companion CSVs (`pl_pfile`, `othername_pfile`, …)

- **Status:** Not ingested. No `payor_source_records` or downstream ER use is defined for these files yet.
- **When to add:** After a product decision ties each file to a concrete feature (aliases, practice locations, etc.) and a target schema.

## Distinct “provider-data” bulk on data.cms.gov (non-NPPES)

- **Status:** No separate importer. **Provider directory** in this repo is driven by **NPPES `npidata`** → `nppes_directory_providers` (and provider registry flows), not by a second CMS catalog.
- **When to add:** Only if a specific dataset is required beyond NPPES; then add a source contract (see `PAYOR_SOURCE_CONTRACTS.md`), download location, parser, and table — and document how it relates (or does not relate) to `nppes_directory_providers`.


---

<a id="provider-directory-pipeline-and-public-search"></a>

## PROVIDER DIRECTORY PIPELINE AND PUBLIC SEARCH

*Merged from `docs/Payor/PROVIDER_DIRECTORY_PIPELINE_AND_PUBLIC_SEARCH.md` on 2026-06-02.*

# Provider directory pipeline and public search

> **Last reviewed:** 2026-05-25

Public provider search backed by NPPES ingest and entity resolution. Related contracts: [`PROVIDER_NETWORK_INGESTION_CONTRACTS.md`](./PROVIDER_NETWORK_INGESTION_CONTRACTS.md).

## Data pipeline (offline)

1. **NPPES bulk import** — CMS dissemination files → `provider_registry_*` tables (migrations `039_nppes_*`, `050_nppes_fhir_endpoints`).
2. **Entity resolution** — normalize → block → fuzzy → resolve → canonicalize (see [`PAYOR_ARCHITECTURE_AND_ENTITY_RESOLUTION.md`](./PAYOR_ARCHITECTURE_AND_ENTITY_RESOLUTION.md)).
3. **Network linking** — `provider_payer_networks` links providers to payor entities for in-network precheck.

Operator commands: [`PAYOR_CMS_TRACK_RUNBOOK.md`](./PAYOR_CMS_TRACK_RUNBOOK.md), `npm run run:payor:cms-pipeline`.

## Runtime search service

Implementation: [`middleware-platform/services/provider-search-service.js`](../../middleware-platform/services/provider-search-service.js)

`listProviderSearchResults({ taxonomyCode, latitude, longitude, radiusMiles, payorEntityId, page, pageSize })`:

- Reads `provider_registry_entities` + taxonomy and payer network joins
- Optional geo filter when lat/lon/radius provided
- Returns paginated active providers with taxonomy and provenance metadata

## HTTP API (intended)

`server.js` mounts:

```javascript
app.use('/api/public/providers', publicCatalogReadLimiter, publicProviderSearchRoutes);
```

**Code gap (2026-05-25):** `require('./routes/public-provider-search.js')` is referenced in [`server.js`](../../middleware-platform/server.js) but **`middleware-platform/routes/public-provider-search.js` is missing** from the repo. Restore the route module or remove the mount in a follow-up PR.

Expected query params (when route exists): taxonomy code, geo, payor entity id, pagination.

## Landing UI

Find-provider E2E: `npm run test:e2e-landing:find-provider` (Playwright). Historically referenced `FindProvider.js` in archived `_archive/littlelab-landing`.

## Feature flags

| Env | Effect |
|-----|--------|
| `PROVIDER_NETWORK_PRECHECK_ENABLED` | Attach network decision in eligibility/claims |
| `PROVIDER_NETWORK_PRECHECK_SHADOW` | Log decision without gating |
| `PAYOR_CANONICAL_RESOLVER_ENABLED` | Resolve payor via canonical registry |

## Related

- [`docs/Payor/README.md`](./README.md)
- [`public-plan-search.js`](../../middleware-platform/routes/public-plan-search.js) — Medicare plan search (separate surface)


---

<a id="provider-network-ingestion-contracts"></a>

## PROVIDER NETWORK INGESTION CONTRACTS

*Merged from `docs/Payor/PROVIDER_NETWORK_INGESTION_CONTRACTS.md` on 2026-06-02.*

# Provider Network Ingestion Contracts

## Primary Source Path Decision

Selected primary path: **CMS MA provider directories**.

Rationale:
- Public machine-readable cadence and stable publication channel.
- Contains payer/plan hints and provider NPI fields suitable for deterministic provider/payor linkage.
- Lower onboarding friction than CAQH access workflows and lower parsing variance than broad payer MRF sets for initial rollout.

## Ingestion Contract (Phase 1)

- **Source**: CMS MA provider directory extracts (CSV preferred).
- **Cadence**: Monthly pull (with optional weekly refresh when CMS republishes).
- **Owner**: Middleware platform ingestion owner.
- **Minimum required fields**:
  - `provider_npi`
  - payer hint (`payer_name` or `payer_id` or equivalent plan/org field)
  - optional network status (`network_status`), effective dates, network name
- **Schema drift policy**:
  - Soft-parse unknown columns and preserve full raw row in `payload_json`.
  - Fail ingest only when required identity fields are absent (`provider_npi` and payer hint).
  - Emit skipped-row counts and keep source artifact for replay.

## Parser Output Contract

Parser writes canonicalized records into `provider_network_source_records`:
- `source`, `source_record_id`
- `provider_npi`
- `payer_hint`
- `network_name`, `network_status`
- `effective_start_date`, `effective_end_date`
- `payload_json` (full raw row provenance)

## Operational Notes

- Linker stage maps:
  - `provider_npi` -> `provider_registry_entities.canonical_npi`
  - `payer_hint` -> `payor_entity_aliases.alias_normalized` -> `payor_canonical_entities`
- Unmatched provider/payor rows are retained for iterative alias expansion and replay.


---

<a id="production-readiness-baseline"></a>

## PRODUCTION READINESS BASELINE

*Merged from `docs/Payor/PRODUCTION_READINESS_BASELINE.md` on 2026-06-02.*

# Payor ER Production Readiness Baseline

## Purpose

Define explicit acceptance criteria for the first network-unrestricted payor ER run with real source coverage (Office Ally + Inovalon + NPPES), so readiness is pass/fail instead of subjective.

## Current Controlled-Environment Status

- Source contamination from `nucc_csv` / `nucc` is excluded from payor ER blocking scope.
- Degraded-mode NPPES-only run yielding `candidate_pair_count = 0` is expected and acceptable.
- Provider routing split, drift checks, and precheck behavior are validated in controlled tests.
- CMS MA benefits + premium + service-area + ZIP crosswalk ingestion scripts are implemented and exercised on live DB path.
- Public MA search endpoint (`/api/public/plans/search`) is implemented with explainable output transform.

## Current live capabilities baseline (2026-04-26)

The following are now considered available baseline capabilities (public data only):

- `payor_plan_benefits` populated (CMS PBP 2026)
- `payor_plan_premiums` populated (CY2026 Landscape)
- `payor_plan_service_areas` populated (MA Contract Service Area)
- `zip_county_crosswalk` populated (Census ZCTA->county)
- Query path validated: `ZIP -> county -> eligible contract -> premium + benefit flags`

Known temporary guardrail:

- ZIP `33101` route-level stopgap enforces `state_abbr='FL'` pending broader crosswalk disambiguation tuning.

## First Real Run Acceptance Criteria

```js
const ACCEPTANCE_CRITERIA_FIRST_REAL_RUN = {
  eligible_record_count:  { min: 8000 },  // OA + Inovalon + NPPES org records minus null/invalid rows
  candidate_pair_count:   { min: 500 },   // cross-source blocking should generate non-trivial candidate set
  auto_merge_rate:        { min: 0.15 },  // floor expectation for high-confidence national payer overlaps
  top_pair_quality:       'org names only, zero person-name collisions in top scored pairs',
  routed_provider_rows:   { min: 1 },     // confirms Type-1 routing path is actively exercised
  routed_payor_rows:      { min: 1 }      // confirms Type-2 payer routing path is actively exercised
};
```

## Hard Fail Conditions

- Any top scored pair in quality sample contains obvious person-only names.
- `routed_provider_rows = 0` or `routed_payor_rows = 0` after ingest run.
- `candidate_pair_count = 0` when Office Ally and Inovalon are present.
- Source contamination reappears in payor ER scope (for example, `nucc_csv` in blocking sources).

## CMS-authoritative track (no Office Ally / Inovalon)

When vendor files are intentionally out of scope, use **`PAYOR_READINESS_VENDOR_MODE=cms_only`** (or **`PAYOR_CMS_AUTHORITATIVE_TRACK_ONLY=1`**) for Step 0–2 readiness so OA/Inovalon gates are waived. Treat “first real run” quality against **NPPES + CMS MA (+ NUCC where applicable)** only.

Suggested acceptance object for that track (adjust minima after first national bulk ingest):

```js
const ACCEPTANCE_CRITERIA_CMS_AUTHORITATIVE = {
  eligible_record_count:  { min: 1000 },   // payor-shaped rows after null/invalid drops (tune after ingest)
  candidate_pair_count:   { min: 0 },      // 0 acceptable until multi-source overlap exists beyond NPPES-only
  auto_merge_rate:        { min: 0 },       // not meaningful until blocking produces merge candidates
  top_pair_quality:       'org names only; no person-name collisions in scored samples',
  routed_provider_rows:   { min: 1 },      // still require routing paths exercised when Type-1 data exists
  routed_payor_rows:      { min: 1 }       // Type-2 / payer routing exercised after nppes_bulk (or equivalent) ingest
};
```

Hard fails for CMS-only remain: person-name collisions in top pairs, **zero** routed provider/payor rows when the corresponding ingest tables are populated, and source contamination in blocking scope.

Operator checklist (commands, `DB_PATH`, env toggles, drift seed): **`docs/Payor/PAYOR_CMS_TRACK_RUNBOOK.md`**.

## Validation Sequence for First Real Run

1. Run Tier-1 ingest with network-unrestricted access.
2. Run normalization, blocking, fuzzy-match, resolution-decisions, and observability report.
3. Validate against baseline thresholds above.
4. Archive report artifacts with timestamp and commit SHA.
