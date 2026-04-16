# PHI/PII Data Inventory and Classification (Payments + Impact)

## Inventory authority

- Backed by table: `data_inventory_registry`
- Admin APIs:
  - `POST /api/admin/impact/privacy/seed-inventory`
  - `GET /api/admin/impact/privacy/inventory`

## Classification tiers

- `public_aggregate`: safe delayed aggregates only
- `internal`: operational non-sensitive
- `internal_sensitive`: contains PII, restricted role-based access
- `restricted_phi`: contains PHI, strict access and audit

## Required fields per dataset

- `contains_phi` / `contains_pii`
- `privacy_tier`
- `retention_days`
- `owner`
- `access_roles`
- `redaction_policy`

## Payment + impact baseline datasets

- `financial_events` (PII, internal_sensitive)
- `reconciliation_exceptions` (internal)
- `impact_ledger_events` (PII possible, internal_sensitive)
- `fhir_patients` (PHI/PII, restricted_phi)

