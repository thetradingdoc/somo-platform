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

