# Category Data Completeness Playbook

## Scope

This playbook covers the highest blocker cohort: records where route is `unknown` and both `product_name` and `ingredients_text` are missing.

## Enrichment Policy

1. **Source re-fetch**
   - Retry upstream pull for stale records first.
   - Do not overwrite richer local data with emptier upstream payloads.

2. **OFF fallback**
   - If OBF lookup is sparse, attempt OFF cross-lookup by barcode.
   - Keep source provenance in output (`data_source`, `resolved_catalog`).

3. **OCR/manual ingestion**
   - For unresolved scans, allow label OCR/manual ingredient entry path.
   - Mark rows with ingestion source for auditability.

4. **Deduping**
   - Deduplicate by normalized barcode.
   - Keep latest non-empty product profile when duplicates disagree.

## KPIs

- `% unknown missing both`
- `% unknown with ingredients`
- Weekly delta target for each KPI (set per sprint).

## Exit Criteria

Do not mark backlog solved while missing-both unknown cohort remains above agreed threshold.
