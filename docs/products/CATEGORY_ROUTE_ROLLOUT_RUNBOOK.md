# Category Route Rollout Runbook

## Ownership

- DRI: Middleware Platform Team
- Backup DRI: Product Data Ops
- Review cadence: Weekly (every Monday) map/rule review and unknown-rate trend check.

## Environment Flags

- `CATEGORY_ROUTE_MAP_FILE`  
  Primary map file (relative to `middleware-platform/`), default: `taxonomy/category-route-map.v1.json`
- `CATEGORY_ROUTE_SHADOW_MAP_FILE`  
  Candidate map file for compute-only or canary evaluation.
- `CATEGORY_ROUTE_CANARY_PERCENT`  
  Stable hash canary percentage (`0-100`) using barcode.
- `CATEGORY_ROUTE_MODE`  
  `normal` (default) or `shadow_only`.

## Step 6 Rollout Checklist

### 1) Dev stage

1. Set map candidates in env:
   - `CATEGORY_ROUTE_MAP_FILE=taxonomy/category-route-map.v1.json`
   - optionally `CATEGORY_ROUTE_SHADOW_MAP_FILE=taxonomy/category-route-map.v1.json`
2. Run:
   - `npm run catalog:rollout:check`
   - `npm run test:session-orchestration` (or relevant scan tests)
3. Compare unknown-rate and route distribution output in `tmp/category-route-observability.candidate.json`.

### 2) Staging deploy

1. Deploy with `CATEGORY_ROUTE_SHADOW_MAP_FILE` set and `CATEGORY_ROUTE_CANARY_PERCENT=0`.
2. Verify API payload fields:
   - `category_route_*`
   - `category_route_shadow` present when shadow enabled
3. Run E2E scan suite and API health checks.

### 3) Production rollout (canary)

1. Start at `CATEGORY_ROUTE_CANARY_PERCENT=5`.
2. Monitor unknown-rate and route shifts for 24h.
3. Increase gradually (5% -> 20% -> 50% -> 100%) only if guard thresholds pass.

### 4) Post-deploy (24–48h)

1. Generate post-deploy report:
   - `npm run catalog:observability:report`
2. Compare with baseline:
   - `npm run catalog:regression:guard`
3. Record summary in release notes (unknown delta + top route shifts + top unknown tags).

## Rollback Procedure (tested)

Immediate rollback options:

1. Set `CATEGORY_ROUTE_CANARY_PERCENT=0`.
2. Remove `CATEGORY_ROUTE_SHADOW_MAP_FILE`.
3. Keep `CATEGORY_ROUTE_MAP_FILE` on known-good version.
4. Re-run:
   - `npm run catalog:rollout:check`
5. Confirm route output is stable and golden diff passes.

## Shadow Mode (compute-only)

Set:

- `CATEGORY_ROUTE_MODE=shadow_only`
- `CATEGORY_ROUTE_SHADOW_MAP_FILE=<candidate-map>`

Behavior:

- API returns active category from shadow map.
- Compare `category_route` and `category_route_shadow` fields during validation before enabling canary.
