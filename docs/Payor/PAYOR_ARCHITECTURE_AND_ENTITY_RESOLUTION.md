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
