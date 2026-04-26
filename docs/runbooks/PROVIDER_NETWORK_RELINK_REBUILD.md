# Provider Network Relink/Rebuild Runbook

## Purpose

Rebuild provider-to-payor network links from raw network evidence, validate quality, and safely roll forward.

## Preconditions

- Provider registry seed and dedup have run:
  - `npm run run:provider:registry:npi-dedup --prefix middleware-platform`
- Network evidence loaded:
  - `npm run import:provider:network-evidence --prefix middleware-platform -- --input=/path/to/provider_network.csv`
- Canonical payor aliases available in `payor_entity_aliases`.

## Rebuild Procedure

1. **Snapshot current linkage metrics**
   - `npm run report:provider:network-consistency --prefix middleware-platform`
   - `npm run report:provider:network-drift-quality --prefix middleware-platform`

2. **Run linker**
   - `npm run run:provider:network-linker --prefix middleware-platform`

3. **Validate post-link quality**
   - `npm run report:provider:network-consistency --prefix middleware-platform`
   - `npm run report:provider:network-drift-quality --prefix middleware-platform`
   - Block rollout if:
     - `invalid_status_links > 0`
     - `invalid_date_range_links > 0`
     - orphan link counts are non-zero

4. **Runtime verification**
   - With `PROVIDER_NETWORK_PRECHECK_SHADOW=1`, run eligibility/claim smoke tests and confirm `provider_network_precheck` payload is present.
   - If metrics are healthy, enable `PROVIDER_NETWORK_PRECHECK_ENABLED=1`.

## Troubleshooting

- **High `missing_payor_matches` in linker output**
  - Expand `payor_entity_aliases` for payer hints seen in network source.
- **High orphan source records**
  - Re-run `run:provider:registry:npi-dedup` and confirm provider NPIs are present.
- **Conflicting status drift pairs**
  - Prefer newest evidence source; reimport stale sources with corrected effective dates.

## Rollback

- Disable runtime behavior:
  - `PROVIDER_NETWORK_PRECHECK_ENABLED=0`
- Keep `PROVIDER_NETWORK_PRECHECK_SHADOW=1` to observe without side effects.
- Re-run linker after correcting source payload or alias mappings.

