# Category Classification Baseline (Phase 0)

## Scope

- Catalog sources: OBF and OFF index tables (`products_obf_index`, `products_off_index`)
- API merge path: landing barcode flow tries OBF first, then OFF fallback
- Current UI unclassified behavior: route resolves to `unknown` when no matching category rule exists

## Definition of "Unclassified" (locked for v1)

For baseline and KPI reporting, **unclassified** means:

- `category_route = "unknown"` after current route resolver logic, OR
- no route assigned in API payload when routing is expected.

For historical comparison to current landing behavior, we also track:

- `unknown_by_legacy_rules`: legacy route function using substring checks (`cosmetic|hygiene|non_food`) on `categories_tags`.

## Baseline Counts (captured)

### GCS OBF baseline file

- Source: `gs://skinandcare-media-staging/obf/raw/full/en.openbeautyfacts.org.products.csv.gz`
- Data rows: `64,349`
- `ingredients_text` present: `17,955`
- `ingredients_tags` present: `17,945`
- `ingredients_analysis_tags` present: `18,600`
- `categories_tags` missing: `38,990` (60.6%)
- `unknown_by_legacy_rules`: `51,243`

### Local dev SQLite snapshot (reference only)

- `products_obf_index`: 51 rows
- `products_off_index`: 6 rows

This local sample is not representative of full catalog distribution and should not be used for KPI targets.

## Unclassified Candidate Histogram (OBF, legacy unknown slice)

Top category tags among legacy-unknown rows:

1. `en:hair` (2000)
2. `en:shampoos` (1661)
3. `en:body` (926)
4. `en:face` (880)
5. `en:suncare` (522)
6. `en:in-sun-protections` (479)
7. `en:open-beauty-facts` (466)
8. `en:sunscreen` (449)
9. `en:non-open-products-facts` (416)
10. `en:facial-creams` (379)
11. `en:makeup` (352)
12. `en:body-creams` (326)
13. `en:hand-creams` (289)
14. `en:hair-care` (238)
15. `en:accessories` (224)
16. `en:cleansers` (223)
17. `en:hair-conditioners` (214)
18. `en:perfumes` (184)
19. `en:lip-balms` (172)
20. `en:anti-dandruff-shampoos` (157)

## Targets (v1)

- Reduce unclassified rate by at least 50% vs legacy baseline on OBF feed.
- Keep residual (unknown + low confidence) under 10% after map + heuristic pass.
- Keep route flip regressions in protected golden barcode set under 1% per release (or explicit approved exceptions).

## Notes / Known Gaps

- OFF full baseline GCS object is not yet available in the same staging bucket.
- OFF-specific nutritional metadata (`nova_group`, `nutriscore_grade`) is not stored in current OFF index schema and requires separate ingestion if needed for route policy.
