# Provider/Prescription DB Rename Phase 2 Plan (Optional)

## Objective
Provide a zero-downtime path to physical DB naming changes if desired.

## Recommended approach
1. Keep existing tables/columns as source of truth.
2. Add compatibility views (or query adapters) with provider/prescription names.
3. Migrate write paths to abstraction layer first.
4. Backfill/dual-write only if physical rename is required.
5. Cut over read paths.
6. Remove old names only after stability window.

## Candidate mappings
- `merchants` -> `providers`
- `products` -> `prescriptions`
- `merchant_orders` -> `provider_orders`
- `merchant_id` -> `provider_id`
- `product_id` -> `prescription_id`

## Risk controls
- Run all payment/auth regression suites before and after each step.
- Verify webhook handlers keep foreign key integrity.
- Keep rollback SQL/scripts ready for each migration step.

## Success criteria
- No increase in checkout failures.
- No increase in auth-related 4xx/5xx errors.
- All API contracts continue to accept legacy payloads through deprecation window.
