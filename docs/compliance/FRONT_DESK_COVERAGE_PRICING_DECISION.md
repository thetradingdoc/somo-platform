# Front Desk — Kelly Voice Hours Pricing Decision

**Decision date:** 2026-06-30  
**Status:** Locked for pilot #1  
**Related todo:** `fd0-coverage-pricing`  
**Not to be confused with:** eligibility/check pricing (`FRONT_DESK_ELIGIBILITY_PRICING_DECISION.md`)

## Context

NYC front desk job posts show two hiring patterns:

1. **Full replacement** — Kelly answers all business hours (40+ hrs/week).
2. **Coverage mode** — Kelly fills gaps only (lunch, peak hours, M/W/F split shifts).

Coverage mode is a **schedule configuration**, not a separate product SKU for pilot.

## Decision

Map coverage mode to **existing subscription tiers by expected voice minutes**, not a 4th Stripe product.

| Mode | Typical schedule | Est. minutes/mo | Tier | Price |
|------|------------------|-----------------|------|-------|
| Light coverage | Lunch / peak (8–16 hrs/wk) | 150–300 | **Starter** | **$79/mo** |
| Split-shift coverage | M/W/F or similar (24–36 hrs/wk) | 400–800 | **Practice** | **$199/mo** |
| Full replacement | Full business week | 800–2000+ | **Practice → Clinic Pro** | **$199–399/mo** |

## Runtime (Phase 1)

- `coverage_mode`: `full_replacement` | `coverage` (tenant flag — `fd1-coverage-mode-runtime`)
- `coverage_hours`: weekly JSON schedule (same shape as `business_hours`)
- Outside coverage hours → forward to `transfer_number` (office PSTN)
- Kelly pause / kill-switch remain separate controls (`fd4-agent-controls`)

## Pilot commercial

- Sell **Practice @ $199** for first NYC dental pilot regardless of coverage vs full (loss-leader for data).
- Revisit tier mapping after 60 days of real minute usage.

## Deferred

- FE-P1-6 checkout UX with coverage-mode tier selector (after pilot validates conversion).
