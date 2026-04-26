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

