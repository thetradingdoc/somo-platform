# Category Route Integration and Governance

## Step 4 Integration Decisions

- Shared logic lives in middleware resolver: `services/category-route-resolver.js`.
- Landing scan now prefers server contract fields:
  - `category_route`
  - `category_route_source`
  - `category_route_confidence`
  - `category_route_rule_id`
  - `category_route_fallback`
- Client-side derive remains as backward-compatible fallback only.

## API Contract (v1)

Public barcode responses include:

- `category_route`
- `category_route_source` (`taxonomy_map` | `heuristic`)
- `category_route_confidence` (`high` | `medium` | `low`)
- `category_route_rule_id` (deterministic resolver rule)
- `category_route_fallback` (safe copy for unknown/low confidence)

## Backfill Strategy

- Strategy selected: **lazy recompute on read** (current API request path).
- Optional next step: nightly snapshot materialization to a reporting table.
- Unknown remains valid fallback for compatibility.

## Step 4.5 Observability and Release Controls

Commands:

- Build observability snapshot:
  - `node scripts/category-route-observability-report.cjs`
- Compare baseline vs candidate with thresholds:
  - `node scripts/category-route-regression-guard.cjs --baseline <file> --candidate <file>`
- Golden diff gate for protected barcode fixture:
  - `node scripts/category-route-golden-diff.cjs`

Suggested thresholds:

- Unknown-rate regression max delta: `0.02`
- Per-route distribution shift max absolute delta: `0.05`

## Step 5 Quality, Safety, Governance

### Spot-check protocol

- Per release, sample 100-200 rows:
  - 30% unknown
  - 30% heuristic
  - 40% taxonomy-map resolved
- Include changed-route rows from previous release.

### Regression suite

- Deterministic unit tests in `__tests__/category-route-resolver.test.js`
- Golden fixture in `tests/fixtures/category-route-golden.json`
- Gate run in CI with `category-route-golden-diff.cjs`.

### Documentation

- Classification baseline: `docs/products/CATEGORY_CLASSIFICATION_BASELINE.md`
- Reviewer and model policy: `docs/products/CATEGORY_REVIEW_AND_MODEL_POLICY.md`
- This integration/governance doc.

### Privacy

- Resolver consumes only product catalog fields:
  - tags/hierarchy
  - product name
  - brand
  - ingredients text
- No patient identifiers are used in route classification.
