# Payor Entity Resolution TODOs

## Goal

Build an offline 7-step payor entity-resolution pipeline (Office Ally + Inovalon + existing sources) that writes a canonical payor registry to SQLite, and switch runtime claim/eligibility lookup paths to canonical lookup (no runtime fuzzy matching).

---

## 0) Prerequisites and Safety Fixes

- [x] **Fix payer search contract mismatch in `server.js`**
  - [x] Update insurance update flow to handle `PayerCacheService.searchPayer(...)` response shape (`{ success, payers: [...] }`) correctly.
  - [x] Handle 0-match / 1-match / multi-match deterministically.
  - [x] Add defensive error response for ambiguous payer results.
- [x] **Add regression tests for payer resolution contract**
  - [x] Test: payer name resolves to single payer ID.
  - [x] Test: ambiguous results return suggestions.
  - [x] Test: no match returns actionable error.
- [x] **Define canonical naming convention**
  - [x] Decide whether docs/code should standardize on `payor` (business) vs `payer` (existing code).
  - [x] Keep compatibility with existing `insurance_payers` usage.
  - [x] Decision documented in `docs/Payor/PAYOR_NAMING_CONVENTION.md`.

**Acceptance criteria**
- Insurance update path no longer assumes `payer_id` at top-level from `searchPayer`.
- All payer resolution tests pass.

---

## 1) Step 1 - Raw Ingest

- [x] **Create ingest batch metadata table(s) in `middleware-platform/database.js`**
  - [x] `payor_ingest_batches` (source, file name, checksum, started_at, completed_at, record_count, status, error_summary).
- [x] **Create raw source records table(s)**
  - [x] `payor_source_records` (batch_id, source, source_record_id, raw_name, raw_payer_id, raw_npi, raw_ein, raw_state_hint, payload_json, created_at).
  - [x] Add indexes on `(source, source_record_id)`, `raw_payer_id`, `raw_npi`.
- [x] **Build Office Ally ingest script**
  - [x] Add `middleware-platform/scripts/import-payor-office-ally.cjs`.
  - [x] Parse source format (CSV/JSON/XLSX), map to raw table fields, record batch stats.
- [x] **Build Inovalon ingest script**
  - [x] Add `middleware-platform/scripts/import-payor-inovalon.cjs`.
  - [x] Parse source format (CSV/JSON/XLSX), map fields, record batch stats.
- [x] **Add idempotent ingest behavior**
  - [x] Prevent duplicate load for same source+file checksum unless forced.

### Step 1 extraction flow status (end-to-end)

#### A) Data completeness first (highest priority before later ER steps)

- [x] **Degraded source mode (Office Ally unavailable) is explicitly tracked**
  - [x] Readiness script supports **CMS-only / vendor-waived** mode: `PAYOR_READINESS_VENDOR_MODE=cms_only` or `PAYOR_CMS_AUTHORITATIVE_TRACK_ONLY=1` → Office Ally + Inovalon gates are **waived** (listed in JSON, not counted toward `pass`).
  - [x] Default mode still requires vendor batches when unset (strict procurement path).
  - [x] `report-payor-step0-2-readiness.cjs` uses repo-relative doc path + writes under `middleware-platform/test-results/readiness-artifacts/`.

- [x] **Tier-1 source depth is production-ready (not just artifact reachability)**
  - [x] CMS: ingest machine-readable payer-relevant datasets (not homepage metadata only).
  - [x] NPPES: ingest bulk dissemination files for org/provider identity coverage at scale.
  - [x] NPPES API: define controlled query strategy (seed lists) and persist raw API payloads.
  - [x] NUCC: ingest latest taxonomy CSV + versioned historical snapshots.
  - [x] WEDI: identify machine-readable datasets (if any) or mark as reference-only source.
- [x] **Tier-1 identifiers captured at raw stage**
  - [x] NPI capture coverage report by source.
  - [x] payer_id capture coverage report by source.
  - [x] EIN/tax ID capture coverage report by source.
  - [x] State/plan hints capture coverage report by source.
- [x] **Business-value fields captured at raw stage (for later normalization/linking)**
  - [x] service/taxonomy offerings (provider scope) where available.
  - [x] plan/premium/payment signals where available.
  - [x] coverage/service eligibility hints where available.
  - [x] routing/clearinghouse fields where available.
- [ ] **Production source acquisition (vendor exports — procurement)** — *blocked on customer-provided export files; importers exist.*
  - [ ] Office Ally production export ingested when a valid file is available (`import:payor:office-ally`).
  - [ ] Inovalon production export ingested when a valid file is available (`import:payor:inovalon`).
  - [x] Source contracts documented: refresh cadence, ownership, and schema drift policy (`docs/Payor/PAYOR_SOURCE_CONTRACTS.md`).

#### B) Pipeline plumbing (implemented; keep hardening)

- [x] Pull/download file from source.
  - [x] Local file mode implemented.
  - [x] URL download mode implemented via `--source-url=...`.
- [x] Compute checksum.
- [x] Check idempotency (`source + checksum`).
- [x] Upload raw artifact to GCS.
  - [x] Implemented optional GCS upload via `PAYOR_RAW_GCS_BUCKET` or `PAYOR_RAW_GCS_PREFIX`.
  - [x] Configure/validate production payor GCS bucket in environment.
- [x] Create ingest batch row with `gcs_uri`.
- [x] Parse rows minimally and insert raw row records.
- [x] Mark batch completed with counts and errors.
- [x] Emit ingest metrics/logs.
  - [x] Structured JSON batch completion metric logged.
  - [x] Wire metric into local / webhook sinks: `PAYOR_INGEST_METRICS_LOG_PATH`, optional `PAYOR_INGEST_METRICS_WEBHOOK_URL` (dashboard UI still optional).

#### C) Current pull status snapshot (executed)

- [x] Pull and ingest initial Tier 1 snapshots into raw tables:
  - [x] CMS.gov artifact-level pull
  - [x] NPPES API sample pull + NPPES bulk artifact reference
  - [x] NUCC CSV rows + WEDI artifact metadata
- [x] Upgrade from initial snapshots to full authoritative dataset coverage before Step 2+ (CMS machine dataset + seeded NPPES API + NUCC snapshots + WEDI reference-only classification completed)

**Acceptance criteria (Step 1 complete for strategic goal)**
- Raw ingest includes full/high-coverage Tier-1 machine datasets, not only artifact metadata.
- Structured IDs (NPI/payer_id/EIN) have measured capture coverage and are queryable by source.
- Office Ally + Inovalon production exports are ingested with provenance.
- Every batch is replayable (checksum, source URL/path, artifact URI, counts, status, errors).

---

## 2) Step 2 - Normalization

- [x] **Create normalization dictionary tables**
  - [x] `payor_abbreviation_dictionary` (`abbr`, `expanded_form`, `active`, `source`, `updated_at`).
  - [x] `payor_stopwords` (seed with insurance/company/inc/llc/of/the/etc.).
- [x] **Create normalized records table**
  - [x] `payor_normalized_records` (source_record_id FK, normalized_name, normalized_tokens_json, canonical_tokens_json, stripped_state, soundex_key, prefix_key, normalization_version).
- [x] **Implement normalization module**
  - [x] Add `middleware-platform/services/payor-normalization-service.js`.
  - [x] Deterministic transforms:
    - [x] lowercase
    - [x] strip punctuation
    - [x] abbreviation expansion
    - [x] stopword removal
    - [x] state suffix extraction
    - [x] soundex/prefix key generation
- [x] **Seed abbreviation dictionary**
  - [x] Initial set (~50+) including UHC, BCBS, HCSC, etc.
  - [x] Create script to append new abbreviations discovered during review.
- [x] **Normalization tests**
  - [x] Input/output snapshot tests for known payer variants.
  - [x] State extraction tests (e.g., "of Ohio").

**Acceptance criteria**
- Same raw name always yields same normalized output.
- Known abbreviations and stopwords are expanded/removed correctly.

---

## 3) Step 3 - Blocking

- [x] **Create candidate table**
  - [x] `payor_match_candidates` (left_normalized_id, right_normalized_id, block_key_type, block_key_value, batch_id, created_at).
  - [x] Unique constraint to avoid duplicate candidate pairs.
- [x] **Implement blocking job**
  - [x] Add `middleware-platform/services/payor-blocking-service.js`.
  - [x] Generate candidates for:
    - [x] exact payer ID
    - [x] exact NPI
    - [x] exact EIN (if available)
    - [x] soundex first token
    - [x] normalized prefix key
  - [x] Emit source-level candidate coverage metrics (by source and source-pair) for degraded-mode impact tracking.
- [x] **Short-circuit hard matches**
  - [x] When exact NPI/payer ID indicates deterministic identity, mark for direct merge path.
- [x] **Blocking metrics**
  - [x] Candidate reduction ratio vs naive pair count.
  - [x] Source-level coverage report (records eligible for blocking, candidates generated, unmatched residual by source).
- [x] **Step 3 hardening (before Step 4)**
  - [x] Run blocking with startup migrations skipped for deterministic job execution (`SKIP_STARTUP_MIGRATIONS=1`).
  - [x] Report must be tied to the exact batch returned by the current run (no stale batch selection).
  - [x] Emit block-type metrics (`by_block_key_type`, hard-match rate, cross-source ratio).
  - [x] Emit key-cap diagnostics (`dropped_keys_by_block_type`) for `maxBucketSize` tuning.
  - [x] Assert degraded-mode cross-source policy (`same_source_pair_count = 0`) and fail run if violated.
  - [x] Add fixture-style tests for blocking behavior (hard match, cross-source only, bucket cap).

**Acceptance criteria**
- Candidate set is generated reproducibly.
- Pair count reduced significantly from naive all-vs-all.

---

## 4) Step 4 - Fuzzy Matching

- [x] **Decide scoring runtime**
  - [x] Option A: Node package/runtime implementation selected for immediate in-process scoring.
  - [x] **Option B (Python `rapidfuzz` worker)** — **Deferred:** Node in-process scorer remains canonical (`payor-fuzzy-match-service` + tests). Revisit if batch throughput requires a sidecar worker.
- [x] **Create similarity score table**
  - [x] `payor_similarity_scores` (candidate_id, jaro_winkler, token_sort_ratio, token_set_ratio, scorer_version, created_at).
- [x] **Implement scorer service/job**
  - [x] Add `middleware-platform/services/payor-fuzzy-match-service.js`.
  - [x] Score candidate pairs and persist subscores.
- [x] **Add tests**
  - [x] Typo/spacing cases
  - [x] Word-order swap cases
  - [x] Subset/subsidiary naming cases

**Acceptance criteria**
- All candidates receive stored sub-scores.
- Scorer produces stable outputs for curated fixtures.

---

## 5) Step 5 - Composite Scoring and Decisions

- [x] **Create resolution decisions table**
  - [x] `payor_resolution_decisions` (candidate_id, final_score, decision, reason_codes_json, policy_version, auto_resolved, created_at).
- [x] **Implement weighted policy**
  - [x] NPI exact weight
  - [x] payer ID exact weight
  - [x] fuzzy agreement weight
  - [x] penalties (state/plan suffix mismatch)
- [x] **Implement threshold classes**
  - [x] `>=0.90` auto-merge
  - [x] `0.70-0.89` merge+review flag
  - [x] `<0.70` review candidate
  - [x] `<0.40` distinct
- [x] **Make policy versioned and configurable**
  - [x] Store active policy metadata in table or config file.

**Acceptance criteria**
- Decision outputs are reproducible and auditable by policy version.
- Threshold classes map cleanly to expected curated examples.

---

## 6) Step 6 - Canonical Record Construction

- [x] **Create canonical entity tables**
  - [x] `payor_canonical_entities` (canonical_name, canonical_payer_id, canonical_npi, canonical_ein, state_scope, status, created_at, updated_at).
  - [x] `payor_entity_aliases` (entity_id, alias, alias_normalized, source, confidence).
  - [x] `payor_entity_links` (entity_id, source_record_id, decision_id).
  - [x] `payor_entity_relationships` (parent_entity_id, child_entity_id, relationship_type).
- [x] **Implement canonical builder**
  - [x] Add `middleware-platform/services/payor-canonicalization-service.js`.
  - [x] Field-level source precedence rules:
    - [x] official name/payer ID from authoritative source (e.g., CMS)
    - [x] routing specifics from clearinghouse source when appropriate
  - [x] Persist all aliases.
- [x] **Build alias lookup index**
  - [x] Fast lookup by normalized alias for runtime resolution.
- [x] **Backfill bridge from current `insurance_payers`**
  - [x] Map existing payer cache entries into canonical model.
  - [x] Keep compatibility read path during migration window.

**Acceptance criteria**
- Canonical entity produced for resolved groups.
- Alias lookup returns canonical entity ID consistently.

---

## 7) Step 7 - Review Queue and Human Decisions

- [x] **Create payor review queue tables**
  - [x] `payor_review_queue` (decision_id, status, priority, assigned_to, created_at, updated_at).
  - [x] `payor_review_decisions` (queue_id, reviewer, action, rationale, created_at).
- [x] **Add review queue APIs**
  - [x] list pending
  - [x] fetch candidate details + evidence
  - [x] submit reviewer action (merge/separate/related-subsidiary)
- [x] **Add review UI page**
  - [x] Mirror pattern from `unified-dashboard/business/merge-review.html`.
  - [x] Show pair values, scores, reason codes, and source provenance.
- [x] **Create feedback loop job**
  - [x] Promote reviewed outcomes back into training/evaluation dataset.
  - [x] Track reviewer agreement / override rates.

**Acceptance criteria**
- Ambiguous matches can be reviewed end-to-end via UI/API.
- Decisions are persisted and traceable.

---

## 8) Runtime Integration (No Claim-Time Fuzzy Matching)

- [x] **Create runtime resolver service**
  - [x] Add `middleware-platform/services/payor-registry-resolver-service.js`.
  - [x] Input: payer text + optional IDs.
  - [x] Output: canonical entity + authoritative payer routing values.
- [x] **Integrate resolver into insurance flows**
  - [x] Update eligibility path to resolve payor via canonical registry before payer gateway.
  - [x] Update claim submission path similarly.
- [x] **Keep fallback behavior**
  - [x] If no canonical match, degrade safely (manual review / existing cache path based on flag).
- [x] **Feature flag rollout**
  - [x] `PAYOR_CANONICAL_RESOLVER_ENABLED`
  - [x] `PAYOR_CANONICAL_RESOLVER_SHADOW`

**Acceptance criteria**
- Runtime path does one fast canonical lookup.
- No runtime fuzzy matching in request path.

---

## 9) Observability, Quality Gates, and Ops

- [x] **Metrics**
  - [x] ingest counts by source
  - [x] normalization coverage
  - [x] block reduction ratio
  - [x] auto-merge rate
  - [x] review queue volume/age
  - [x] false-merge correction rate
- [x] **Audit logging**
  - [x] decision traces with source evidence and policy version
  - [x] reviewer action logs
- [x] **Data quality checks**
  - [x] uniqueness constraints validated each batch
  - [x] orphan link checks
  - [x] alias collision checks
- [x] **Runbooks**
  - [x] ingest failure recovery
  - [x] reprocessing a batch
  - [x] rollback from bad scoring policy

**Acceptance criteria**
- Pipeline health and decision quality are measurable and actionable.

---

## 9.1) Blocking Contamination Remediation

- [x] **Ingest routing split (do not discard provider data)**
  - [x] Route NPPES/Inovalon individual provider records (`entity_type_code=1`) away from payor ER inserts.
  - [x] Keep organization records (`entity_type_code=2`) in payor ER ingest.
  - [x] Preserve skipped/provider-routed counters in ingest summaries.
- [x] **Null identity guard**
  - [x] Skip payor ER insert when both `raw_name` and `raw_payer_id` are empty.
  - [x] Emit `skipped_null_identity` metrics per source.
- [x] **Blocking org-signal gate**
  - [x] Add org-keyword/identifier precondition before soft-key candidate generation (`soundex`, `prefix`).
  - [x] Keep exact-ID hard blocks intact.
- [x] **Source naming hygiene**
  - [x] Align source labels (`nppes_bulk` vs `nppes_bulk_rows`) across ingest + blocking defaults.
- [x] **Validation rerun**
  - [x] Re-run Step 1 -> Step 6 pipeline on same DB.
  - [x] Capture before/after candidate quality and score distribution evidence.

**Acceptance criteria**
- Person-provider records no longer contaminate payor blocking/scoring candidates.
- Score distribution reflects payer-like candidates, not person-name collisions.

---

## 10) Testing Matrix

- [x] **Unit tests** (Jest under `middleware-platform/__tests__/payor-*.test.js`)
  - [x] normalization transforms — `payor-normalization-service.test.js`
  - [x] blocking key generation — `payor-blocking-service.test.js`
  - [x] fuzzy and composite scoring functions — `payor-fuzzy-match-service.test.js`, `payor-resolution-scoring-service.test.js`, `payor-resolution-utils.test.js`
- [ ] **Integration tests** (expand over time)
  - [ ] source ingest -> canonical entity creation (scripted E2E on populated DB)
  - [ ] review queue decision lifecycle (API exists; full lifecycle test pending)
  - [x] runtime resolver output correctness — `payor-registry-resolver-service.test.js`, `provider-network-precheck-service.test.js`
- [ ] **Golden dataset tests**
  - [ ] curated true-merge vs true-distinct examples (including state/suffix edge cases)
- [ ] **Performance tests**
  - [ ] batch runtime budget
  - [ ] runtime lookup latency budget

**Acceptance criteria**
- CI includes deterministic coverage for all 7 steps.
- Performance targets documented and met.

---

## 11) Deliverables Checklist

- [x] New DB schema + migrations for payor ER tables (SQLite + `migrations/*` where applicable).
- [x] Ingest scripts for Office Ally + Inovalon (plus CMS/NPPES paths).
- [x] Normalization + blocking + fuzzy + scoring + canonicalization services (pipeline scripts + services).
- [x] **Review queue API** — `GET/POST /api/admin/payor-review-queue*` in `server.js` (Step 7 sync/list).
- [ ] Review queue **UI** (iterate as needed).
- [x] **Runtime canonical resolver** — eligibility + submit-claim paths behind `PAYOR_CANONICAL_RESOLVER_ENABLED` / `PAYOR_CANONICAL_RESOLVER_SHADOW` (`server.js`).
- [ ] **Metrics dashboards (hosted)**; runbooks: `docs/Payor/PAYOR_CMS_TRACK_RUNBOOK.md`, `docs/Payor/PRODUCTION_READINESS_BASELINE.md`, `docs/runbooks/` (expand hosted dashboards separately).
- [x] Documentation updates in `docs/Payor/` (ongoing; see architecture + source contracts + deferred datasets).

---

## Suggested Execution Order

1. Safety fix (contract mismatch) + tests
2. Raw ingest + normalization
3. Blocking + fuzzy + scoring
4. Canonical builder + alias index
5. Review queue API/UI
6. Runtime resolver integration + feature flags
7. Quality gates, metrics, and hardening

---

## 12) Provider Registry and Network Linkage (Post-Step 11)

- [x] **Ready now: provider registry schema + migrations**
  - [x] `provider_registry_entities` (canonical provider identity, NPI hard key, name fields, status, timestamps).
  - [x] `provider_registry_source_links` (provider_entity_id, source_record_id, source, provenance payload).
  - [x] `provider_registry_aliases` (provider_entity_id, alias, alias_normalized, confidence).
  - [x] `provider_taxonomy_links` (provider_entity_id, nucc_code, taxonomy_group, primary_flag, source, confidence).
  - [x] `provider_network_source_records` (raw network evidence rows before canonical linking).
  - [x] `provider_payer_networks` (provider_entity_id, payor_entity_id, network_status, effective dates, confidence, source).
- [x] **Ready now: provider ingest routing + persistence**
  - [x] Route Type 1 NPI records to provider pipeline sink explicitly.
  - [x] Keep Type 2 records in payor ER sink and enforce separation by source contract.
  - [x] Add source-level counters: `routed_provider_rows`, `routed_payor_rows`, `skipped_null_identity`.
- [x] **Ready now: provider dedup/enrichment service (NPI-first)**
  - [x] Deduplicate by exact NPI as primary key (no fuzzy dependency in request path).
  - [x] Enrich provider entity fields from latest/highest-confidence source records.
  - [x] Persist aliases for search compatibility.
  - [x] Populate `provider_taxonomy_links` from existing NUCC ingest evidence.
- [x] **Ready now: specialty + location search**
  - [x] Add provider search service: input taxonomy + location radius + optional payor filter.
  - [x] Return ranked providers with taxonomy evidence and source provenance.
  - [x] Add API endpoint(s) for specialty search and pagination.
- [x] **Blocked (data acquisition decision required): network membership ingestion**
  - [x] Select primary network source path: CMS MA provider directories vs payer machine-readable directories vs CAQH.
  - [x] Add ingestion contracts for selected source(s) (cadence, schema drift policy, owner).
  - [x] Build parser(s) into `provider_network_source_records` with effective dates + source provenance.
- [x] **Blocked (depends on network ingestion): provider-payer network linker**
  - [x] Link provider entities to canonical payor entities from network evidence.
  - [x] Record confidence + provenance in `provider_payer_networks`.
  - [x] Add orphan/consistency checks for broken provider/payor references.
- [x] **Blocked (depends on network linker): runtime in-network precheck integration**
  - [x] Add precheck in claim/eligibility path: rendering provider vs resolved canonical payor network status.
  - [x] Return explicit in-network/out-of-network/unknown decision with trace metadata.
  - [x] Keep feature-flagged fallback behavior during rollout.
- [x] **Credentialing automation foundation (must be explicit)**
  - [x] Define credentialing profile schema (document checklist + completeness fields + verification metadata).
  - [x] Enumerate 30+ credentialing artifacts as concrete checklist rows (not free-text task).
  - [x] Map provider registry fields to enrollment application requirements.
  - [x] Add readiness report for missing credentialing artifacts.
- [x] **Operational quality gates + reporting**
  - [x] Add provider registry observability report (counts, dedup stats, taxonomy coverage, linkage coverage, staleness).
- [x] Add `provider_payer_networks` drift/quality checks.
  - [x] Add runbook for provider-network relink/rebuild.
- [x] **Testing additions**
  - [x] Golden dataset tests for provider dedup: duplicate NPI resolves to single entity.
  - [x] Negative tests: distinct providers do not collapse.
  - [x] Integration tests for provider search filters (taxonomy, location, optional payor).

**Acceptance criteria**
- Type 1 provider data is fully available in a dedicated provider registry.
- Provider taxonomy links are queryable for specialty search.
- Provider-to-payor network linkage is queryable and traceable.
- Runtime paths can perform deterministic in-network prechecks before claim submission.

---

## 13) CMS-authoritative track — data gaps & implementation TODOs

*Use this list when **Office Ally / Inovalon are out of scope** or unavailable; authoritative free sources are CMS MA directory, NPPES `npidata` (Type 2 for payor ER, full file for directory), and NPPES companion files on disk.*

### Shipped (baseline)

- [x] **Canonical raw data tree** — `middleware-platform/data/payor-sources/` with `nppes/`, reserved `office-ally/` / `inovalon/`; override via `PAYOR_DATA_SOURCES_ROOT`.
- [x] **Path resolution** — `scripts/payor-data-sources.cjs` (dissemination dir + largest `npidata_pfile_*.csv`; symlinked dirs supported).
- [x] **Link helper** — `npm run setup:payor-data-sources:link-nppes -- <path/to/NPPES_Data_Dissemination_*_V2>`.
- [x] **NPPES Type 2 → payor ER** — `scripts/import-payor-nppes-bulk.cjs` → `payor_source_records` (`source = nppes_bulk`), stream-safe; npm `import:payor:nppes-bulk`.
- [x] **NPPES directory** — `import-nppes-directory.cjs` / `nppes:import-full` → `nppes_directory_providers`.
- [x] **Docs** — `docs/Payor/PAYOR_ARCHITECTURE_AND_ENTITY_RESOLUTION.md` (canonical directory subsection); `data/payor-sources/README.md`.
- [x] **NPPES FHIR endpoints** — `migrations/050_nppes_fhir_endpoints.js`, `import-nppes-fhir-endpoints.cjs`, `findPreferredNppesEndpointCsvPath`, npm `import:nppes-endpoints`.

### Implement — missing ingest (not in SQLite today)

- [x] **`endpoint_pfile_*.csv` (FHIR endpoints)** — Table `nppes_fhir_endpoints` + streaming import + path discovery (same dissemination folder as `npidata`).
- [x] **Other NPPES companion files** (`pl_pfile`, `othername_pfile`, …) — **Explicitly deferred:** see `docs/Payor/PAYOR_DEFERRED_THIRD_PARTY_DATASETS.md` (no importer until product specifies use cases).
- [x] **Distinct data.cms.gov “provider-data” bulk** — Documented as **not in scope** vs NPPES-driven directory; see same deferred-datasets doc.

### Implement — pipeline & clarity

- [x] **`nppes_bulk` semantics** — Tier-1 zip artifact uses `source = nppes_bulk_artifact` (`nppes_bulk_artifact_*` ids); row-level org ingest remains `nppes_bulk`. Exclusion in `PAYER_ER_EXCLUDED_SOURCES`; docs updated.
- [x] **CMS MA vs blocking** — Documented in `PAYOR_ARCHITECTURE_AND_ENTITY_RESOLUTION.md` (MA rows ingested but excluded from payer ER blocking by design).
- [x] **Normalization at scale** — `run-payor-normalization.cjs --until-done --source=<source>` pages until a short batch; `.env.example` one-liner.
- [x] **Tier-1 pull persistence** — `pull-payor-tier1-sources.cjs` mirrors MA HTML + zip into `data/payor-sources/cms/` after successful fetch.
- [x] **Ingest metrics (local sink)** — `PAYOR_INGEST_METRICS_LOG_PATH` appends JSON lines from `emitIngestMetrics`; centralized dashboard wiring remains §1.B.

### Operational — run order (CMS-only smoke → full)

- [x] **Runbook** — Step-by-step operator order, `DB_PATH`, readiness/metrics env, drift QA: `docs/Payor/PAYOR_CMS_TRACK_RUNBOOK.md`.
- [x] **Orchestrated CMS pipeline (no Ally/Inovalon)** — `npm run run:payor:cms-pipeline` (`scripts/run-payor-cms-track-pipeline.cjs`). Vendor importers stay separate for when files arrive.

### Full NPPES bulk on disk — **correct** operator sequence (real-scale payer ER)

**Prereqs:** `cd middleware-platform`, single **`DB_PATH`** for every command. Without vendor files, keep **`PAYOR_READINESS_VENDOR_MODE=cms_only`** or **`PAYOR_CMS_AUTHORITATIVE_TRACK_ONLY=1`** (see runbook §2).

**Path A — Recommended (one chain, no duplicate ingests)** — The pipeline script runs: migrate → tier-1 pull → **`import:payor:nppes-bulk`** (11GB, Type 2 → payor ER) → **`import:nppes-directory`** → **`import:nppes-endpoints`** → seed dict → **`run:payor:normalization --until-done`** → **`run:payor:blocking`** → **`run:payor:fuzzy-match`** → **`run:payor:resolution-decisions`** → **`run:payor:canonicalization`** → readiness → **`report:payor:ops`**.

**Automation (repo):** **`npm run run:payor:nppes-path-a`** = **`verify:payor:sqlite-context`** then **`run:payor:cms-pipeline`** (covers manual items 2–4 below in one command after you complete step 1).

1. [ ] **Point the repo at the dissemination folder** — `npm run setup:payor-data-sources:link-nppes -- /absolute/path/to/NPPES_Data_Dissemination_*_V2` *or* set **`NPPES_DISSEMINATION_DIR`** (and optionally **`PAYOR_DATA_SOURCES_ROOT`**) in **`.env`**.
2. [ ] **Verify paths before any import** — `npm run verify:payor:sqlite-context` — confirm resolved **`npidata_pfile_*.csv`** (~11GB) and pre-import **`nppes_bulk`** row counts (often **0** before first bulk import).
3. [ ] **Run the full CMS pipeline once** — `npm run run:payor:cms-pipeline` — expect **tens of minutes to hours** (bulk read, normalization passes, blocking/fuzzy at volume). Watch stderr banner for **`sqlite_path`**, CSV path, **`routed_payor_rows`** (target **hundreds of thousands** for national Type 2 orgs), **`routed_provider_rows`**.
4. [ ] **Validate ops output** — `npm run report:payor:ops` (also emitted at end of step 3). Check **`eligible_record_count`**, **`candidate_pair_count`**, **`auto_merge_rate`** against **`docs/Payor/PRODUCTION_READINESS_BASELINE.md`**. Save or paste the JSON summary for regression comparison.

**Path B — You already ran `import:payor:nppes-bulk` + `import:nppes-endpoints` manually** — Do **not** run `run:payor:cms-pipeline` with defaults (it would **re-import** bulk, directory, endpoints). Either:

- [ ] **`npm run run:payor:nppes-path-b-pipeline`** — same as **`run:payor:cms-pipeline -- --skip-nppes-bulk --skip-directory --skip-endpoints`**; append extra flags after `--`, e.g. **`npm run run:payor:nppes-path-b-pipeline -- --skip-migrate --skip-pull`**
- [ ] **`npm run run:payor:cms-pipeline -- --skip-nppes-bulk --skip-directory --skip-endpoints`** (manual equivalent of the line above), **or**
- [ ] **`npm run run:payor:cms-er-replay`** — replay ER tail + reports **without** re-ingest (same skip flags as needed).

**Path C — Manual ER steps only** (same DB, ingest already done) — Order must include **canonicalization** (pipeline does this automatically; easy to omit by hand):

**Automation (repo):** **`npm run run:payor:nppes-path-c-manual`** runs steps 1–6 in order (stops on first failure).

1. [ ] `npm run run:payor:normalization -- --until-done --source=nppes_bulk --limit=5000` — let it run until **0** remaining.
2. [ ] `npm run run:payor:blocking`
3. [ ] `npm run run:payor:fuzzy-match`
4. [ ] `npm run run:payor:resolution-decisions`
5. [ ] **`npm run run:payor:canonicalization`** — **required**; not optional.
6. [ ] `npm run report:payor:ops` (optional: `npm run report:payor:readiness:step0-2`)

**What to watch:** Normalization **`--until-done`** may take many batches at 500k+ org rows. Blocking/fuzzy wall-clock grows with candidate volume; **`report:payor:ops`** is the acceptance check for “pipeline is real,” not only “script exited 0.”

### Legacy numbered checklist (subset of Path A/C)

1. [ ] `npm run migrate` on target `DB_PATH` *(per environment; not automated in CI)* — *or use `npm run run:payor:cms-pipeline` which includes migrate by default*.
2. [ ] `npm run pull:payor:tier1` (MA + NPPES API seed + NUCC + artifacts as implemented).
3. [ ] `npm run import:payor:nppes-bulk` (or stdin from zip) for Type 2 org rows.
4. [ ] `npm run import:nppes-directory` or `npm run nppes:import-full` for directory table.
5. [ ] `npm run import:nppes-endpoints` for `endpoint_pfile` → `nppes_fhir_endpoints`.
6. [ ] `npm run run:payor:normalization -- --until-done --source=nppes_bulk --limit=5000` (tune `--limit`) → `run:payor:blocking` → `run:payor:fuzzy-match` → `run:payor:resolution-decisions` → **`npm run run:payor:canonicalization`** → `npm run report:payor:ops`.

### Vendor exports (optional; not required for CMS track)

- [ ] Office Ally production export — **procurement** until valid file + `import:payor:office-ally`; readiness can **waive** gates with `PAYOR_READINESS_VENDOR_MODE=cms_only` (§1.A).
- [ ] Inovalon production export — same; `import:payor:inovalon` when available.

**Acceptance criteria (section 13)**

- Every **free** CMS file the product claims to use has a **defined table + importer** or an explicit **won’t import** note.
- Payor ER runs are reproducible from documented paths under `data/payor-sources/` without ad hoc `~/Downloads` references.
- Ops/reporting can distinguish artifact-only batches from row-level NPPES org coverage.

---

## 14) Payor — active fix & verification backlog (chat roll-up)

*Prioritized checklist: what to do next after pipeline-vs-data alignment (`first_real_run_meaning`), zero-candidate diagnosis, and Section 12 test plan.*

### A) Data volume & DB hygiene (unblocks meaningful ER + baseline)

- [x] **Full NPPES Type 2 org load** — *Operator:* `npm run import:payor:nppes-bulk` (same `DB_PATH` as downstream). **Guards:** stderr banner via `scripts/payor-sqlite-context.cjs` (`sqlite_path`, resolved `npidata` CSV, pre-import `nppes_bulk` row counts); optional **`--require-min-rows=N`** exits `2` if the run inserts fewer than *N* rows (duplicate skips exempt). National-scale rows still required for dense blocking (`zero_candidates_diagnosis` when sparse).
- [x] **Single DB discipline** — **`npm run verify:payor:sqlite-context`** prints resolved SQLite file + `DB_PATH` + NPPES CSV + counts; `import-payor-nppes-bulk` + **`npm run run:payor:cms-pipeline`** log the same banner at start; **`npm run report:payor:ops`** includes `sqlite_path` / `db_path_env`.
- [x] **Vendor track (optional)** — When exports exist: `import:payor:office-ally`, `import:payor:inovalon`; then **`npm run verify:payor:vendor-env`** hints to clear **`PAYOR_READINESS_VENDOR_MODE=cms_only`** / **`PAYOR_CMS_AUTHORITATIVE_TRACK_ONLY`** so Step 0–2 gates enforce vendors again (inverse hint if batches are still missing).
- [x] **CMS-only baseline policy** — **`docs/Payor/PRODUCTION_READINESS_BASELINE.md`** (CMS-authoritative section) + **`npm run report:payor:ops`** optional `baseline_cms_authoritative` when `PAYOR_OPS_BASELINE_MODE=cms_only` or readiness env; **`PAYOR_OPS_STRICT_BASELINE=1`** folds gates into `pass`.

### B) Pipeline re-run & observability (after A)

- [x] **Normalize at scale** — **`npm run run:payor:cms-er-replay`** replays normalization (`--until-done`) → blocking → fuzzy → resolution → canonicalization → readiness + **`npm run report:payor:ops`** (no re-ingest). Flags: `--skip-*`, `--norm-limit=`, `--norm-source=` (same shape as full CMS pipeline tail).
- [x] **Routing counters sanity** — Ingest scripts write **`payor_audit_log`** rows `event_type=payor_ingest_routing_summary` (`recordPayorIngestRoutingSummary`) for **`nppes_bulk`**, **Inovalon**, **Office Ally**; `emitIngestMetrics` JSON lines include **`routed_provider_rows`**, **`routed_payor_rows`**, **`skipped_null_identity`** when present. **`npm run report:payor:ops`** adds **`metrics.ingest_routing`** (`latest_by_source`, `recent_events`, `sanity_notes`). Set **`PAYOR_OPS_ROUTING_STRICT=1`** to fail **`pass`** when `sanity_notes` is non-empty.

### C) Readiness & metrics env

- [x] **Readiness mode** — `.env.example` documents vars; **`docs/Payor/PAYOR_CMS_TRACK_RUNBOOK.md` §2** has an **owner / flip-back table** (pre-vendor → post-vendor → prod), plus **`npm run verify:payor:vendor-env`** after ingests.
- [x] **Ingest metrics** — Implemented in **`payor-ingest-utils.cjs`** (`PAYOR_INGEST_METRICS_LOG_PATH`, `PAYOR_INGEST_METRICS_WEBHOOK_URL`); runbook **§3** describes log tail + webhook (Datadog/Slack) and cross-check with **`report:payor:ops`**.

### D) Section 12 — provider network / drift (must-close items from HTML plan)

- [x] **Linker conflict resolution** — Covered by `__tests__/provider-network-linker-conflict.test.js` (higher confidence wins; tie → newer `effective_start_date`).
- [x] **Drift report with non-zero network evidence** — **`npm run test:provider:network-drift-quality`** (Jest) seeds drift fixtures and asserts low confidence, invalid status, bad dates, stale, drift pair. CLI: **`npm run seed:provider:network-drift-test-data`** → **`npm run report:provider:network-drift-quality`**.

### E) Regression tests (Block C)

- [x] `npm run test:provider:dedup`
- [x] `npm run test:provider:search-integration`
- [x] `npm run test:provider:network-linker-conflicts`
- [x] Payer ER Jest — **`npm run test:payor:section14-smoke`** bundles provider + payor `__tests__/payor-*.test.js` (see §10 for full matrix over time).

### F) Runtime smoke (Block D)

- [x] **Canonical resolver** — **`__tests__/payor-registry-resolver-service.test.js`** + `resolvePayor` try/catch in **`payor-registry-resolver-service.js`**.
- [x] **In-network precheck** — **`provider-network-precheck-service.js`**: empty **`provider_payer_networks`** → **`no_network_data`**; **`__tests__/provider-network-precheck-service.test.js`**.

### G) Product / delivery still open (not code-only)

- [ ] Review queue **UX** + workflows (§11) — *runbook **§8** checklist until admin UI ships.*
- [ ] Runtime canonical resolver **rollout** (flags, insurance paths) (§11) — *runbook **§8** shadow → enable steps.*
- [ ] **Hosted** metrics dashboards + on-call runbooks beyond `docs/Payor/` — *runbook **§8** webhook/dashboard ownership.*