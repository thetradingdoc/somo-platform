# Category Route API Contract (Locked)

## Canonical Route Enum

- `cosmetic`
- `hygiene`
- `food`
- `supplement`
- `non_food`
- `unknown`

`beauty` is deprecated and should only be handled as a legacy analytics alias.

## Canonical Response Fields

Barcode endpoints (`/api/public/beautyfacts/:barcode`, `/api/public/foodfacts/:barcode`) must return:

- `category_route`
- `category_route_source`
- `category_route_confidence`
- `category_route_rule_id`
- `category_route_fallback`
- `category_route_map_version`
- `category_route_rollout_mode`
- `category_route_canary_applied`
- `category_route_shadow` (optional object)

Legacy alternate keys such as `category_route_top` are not part of the contract.

## Client Consumption Rule

Landing should treat `category_route` as authoritative when it is a valid enum value (including `unknown`).
Client derivation is fallback-only for absent/invalid server values.
