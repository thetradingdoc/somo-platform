# Payor Source Contracts (Step 1)

## Purpose

Define minimum operational contracts for each raw source so ingest is repeatable, owned, and resilient to schema drift.

## Source Contracts

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

## Payer ER Scope Exclusions (Implemented)

The following sources may be ingested for provenance/reference use but are excluded from payer ER blocking/candidate generation:

- `nucc_csv`
- `nucc`
- `nucc_taxonomy`
- `cms_ma_plan_directory`
- `cms_ma_plan_directory_page`
- `nppes_bulk_artifact`

Reason: taxonomy/reference, MA directory row shape, or **artifact-only** provenance rows are poor payer ER blocking keys and cause candidate contamination when mixed into blocking scope. Row-level NPPES org data remains `nppes_bulk` (not excluded).

