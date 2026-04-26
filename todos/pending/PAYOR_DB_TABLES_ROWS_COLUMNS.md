# Payor DB Snapshot (GCP VM)

- DB: `~/payor-db/payor-prod.db` on `payor-pipeline-runner`
- Snapshot time: 2026-04-25 (live query)

## Normalization / Cleanliness Status

- Source records: **1,918,587**
- Normalized records: **1,914,944** (**99.81%** of source)
- Verdict: **Mostly normalized, partially cleaned.**
- Why partial: canonical registry tables are still empty (`payor_canonical_entities`, `payor_entity_aliases`, `payor_entity_links` = 0), and decision coverage is partial relative to candidate volume.

## Tables (Rows + Columns)

### `insurance_payers`
- Rows: **0**
- Columns: `id`, `payer_id`, `payer_name`, `aliases`, `supported_transactions`, `is_active`, `last_updated`, `created_at`

### `payor_abbreviation_dictionary`
- Rows: **0**
- Columns: `abbr`, `expanded_form`, `active`, `source`, `updated_at`

### `payor_audit_log`
- Rows: **50,004**
- Columns: `id`, `event_type`, `decision_id`, `queue_id`, `policy_version`, `payload_json`, `created_at`

### `payor_canonical_entities`
- Rows: **0**
- Columns: `id`, `canonical_name`, `canonical_payer_id`, `canonical_npi`, `canonical_ein`, `state_scope`, `status`, `created_at`, `updated_at`

### `payor_entity_aliases`
- Rows: **0**
- Columns: `id`, `entity_id`, `alias`, `alias_normalized`, `source`, `confidence`, `created_at`

### `payor_entity_links`
- Rows: **0**
- Columns: `id`, `entity_id`, `source_record_id`, `decision_id`, `created_at`

### `payor_entity_relationships`
- Rows: **0**
- Columns: `id`, `parent_entity_id`, `child_entity_id`, `relationship_type`, `confidence`, `created_at`

### `payor_ingest_batches`
- Rows: **11**
- Columns: `id`, `source`, `source_url`, `file_name`, `file_checksum`, `gcs_uri`, `file_size_bytes`, `started_at`, `completed_at`, `record_count`, `status`, `error_summary`, `created_at`

### `payor_match_candidates`
- Rows: **37,173,214**
- Columns: `id`, `left_normalized_id`, `right_normalized_id`, `block_key_type`, `block_key_value`, `batch_id`, `hard_match`, `short_circuit_reason`, `created_at`

### `payor_normalized_records`
- Rows: **1,914,944**
- Columns: `id`, `source_record_id`, `source`, `normalized_name`, `normalized_tokens_json`, `canonical_tokens_json`, `stripped_state`, `soundex_key`, `prefix_key`, `normalization_version`, `created_at`, `updated_at`

### `payor_resolution_decisions`
- Rows: **50,000**
- Columns: `id`, `candidate_id`, `final_score`, `decision`, `reason_codes_json`, `policy_version`, `auto_resolved`, `created_at`, `updated_at`

### `payor_resolution_policies`
- Rows: **1**
- Columns: `version`, `policy_json`, `active`, `created_at`, `updated_at`

### `payor_review_decisions`
- Rows: **0**
- Columns: `id`, `queue_id`, `reviewer`, `action`, `rationale`, `created_at`

### `payor_review_feedback_outcomes`
- Rows: **0**
- Columns: `id`, `review_decision_id`, `queue_id`, `resolution_decision_id`, `policy_version`, `model_decision`, `reviewer_action`, `reviewer`, `rationale`, `agreement`, `override`, `created_at`

### `payor_review_queue`
- Rows: **0**
- Columns: `id`, `decision_id`, `status`, `priority`, `assigned_to`, `created_at`, `updated_at`

### `payor_similarity_scores`
- Rows: **100,000**
- Columns: `id`, `candidate_id`, `jaro_winkler`, `token_sort_ratio`, `token_set_ratio`, `scorer_version`, `created_at`, `updated_at`

### `payor_source_records`
- Rows: **1,918,587**
- Columns: `id`, `batch_id`, `source`, `source_record_id`, `raw_name`, `raw_payer_id`, `raw_npi`, `raw_ein`, `raw_state_hint`, `payload_json`, `created_at`

### `payor_stopwords`
- Rows: **0**
- Columns: `word`, `active`, `source`, `updated_at`
