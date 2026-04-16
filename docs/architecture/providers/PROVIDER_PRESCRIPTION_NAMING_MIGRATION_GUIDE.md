# Provider/Prescription Naming Migration Guide

## Goal
- Move API/domain terminology from `merchant`/`product` to `provider`/`prescription`.
- Preserve backward compatibility for auth, checkout, and payments.

## Canonical Mapping
- `merchant` -> `provider`
- `merchant_id` -> `provider_id`
- `product` -> `prescription`
- `product_id` -> `prescription_id`

## Current Compatibility Contract
- Requests accept both legacy and new fields.
- Responses include both legacy and new fields for critical endpoints.
- Route aliases are available:
  - `/api/providers` (alias of `/api/merchant`)
  - `/api/prescriptions` (alias of `/api/products`)
  - `/api/public/prescriptions` (alias of `/api/public/products`)

## Migration Timeline
1. Phase 1 (now): Alias + dual-field responses.
2. Phase 2: Client adoption to provider/prescription fields.
3. Phase 3: Deprecation warning on legacy-only requests.
4. Phase 4: Optional physical DB rename (or keep compatibility indefinitely).

## Validation Checklist
- Public catalog works with `provider_id`.
- Public checkout works with `prescription_id`.
- Auth-protected routes still enforce existing security.
- Payment flow remains unchanged in behavior.
