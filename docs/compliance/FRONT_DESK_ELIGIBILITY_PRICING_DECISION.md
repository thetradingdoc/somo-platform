# Front Desk — Hybrid Eligibility Pricing Decision

**Decision date:** 2026-06-30  
**Status:** Catalog locked; enforcement wiring pending (`fd2-elig-pricing-pilot`)  
**SSOT:** [`middleware-platform/config/plan-catalog.json`](../../middleware-platform/config/plan-catalog.json)

## Model: Allowance + marked-up overage

Eliminates margin erosion on heavy eligibility volume while keeping a single marketing line per tier.

| Tier | Monthly | Mins | Included checks | Overage / check |
|------|---------|------|-----------------|-----------------|
| Starter | $79 | 300 | 100 | $0.40 |
| Clinic Pro | $399 | 2,000 | 1,000 | $0.30 |
| **Practice** | **$199** | **900** | **400** | **$0.35** |

## Assumed COGS (validate against Stedi contract)

| Component | Assumed unit cost | Weight |
|-----------|-------------------|--------|
| Stedi 271 | $0.15 | 85% |
| DentalXChange fallback | $0.30 | 15% |
| **Blended** | **$0.17/check** | |
| Voice stack | ~$0.05/min | 900 min ≈ $45 at full use |

## Margin validation (Practice @ $199)

| Scenario | Revenue | Est. COGS | Gross margin |
|----------|---------|-----------|--------------|
| Normal (350 checks, 700 min) | $199 | ~$95 | ~52% |
| At allowance (400 checks, 900 min) | $199 | ~$113 | ~43% |
| Heavy (550 checks) **with overage** | $251.50 | ~$139 | ~45% |
| Heavy (550 checks) **no overage** | $199 | ~$139 | **thin / loss** |

**Conclusion:** List prices are correct. **Enforcement** (metering + daily cap + Day 60+ Stripe overage) is required before general release.

## Pilot (Days 0–60)

- Bill flat **$199 Practice**; do not invoice eligibility overages to customer.
- **Enforce 50 checks/day cap** (`ELIGIBILITY_DAILY_CAP=50`) to limit COGS exposure.
- Log all usage via `eligibility_usage_events` + `applyEligibilityUsage`.
- Absorb Stedi COGS as loss-leader per [`phase2-pilot-checklist.md`](../voice-agent/phase2-pilot-checklist.md).

## When to adjust prices (triggers)

| Trigger | Action |
|---------|--------|
| Stedi contract > $0.18/check | Raise Practice overage to $0.40 or base to $219 |
| DXC fallback > 25% of volume | Bump overage rates ~$0.05 |
| Pilot median > 500 checks/mo inside allowance | Lower allowance to 350 or raise base — data-driven only |
| Voice COGS > $0.08/min | Rely on top-up packs; no voice metered overage in v1 |

## Rollout phases

1. **Pilot:** `fd2-elig-pricing-pilot` — wire metering + daily cap (no Stripe overage invoices).
2. **Day 60+:** `fd2-elig-stripe-overage` — metered line items + customer usage UI.

## Risk controls

- Silent daily throttle: 50 checks/tenant/day (queue or polite block).
- Stedi-first; DXC only on thin 271 when `DXC_FALLBACK_TRIGGER_PCT` exceeded (`fd2-dxc-fallback`).
- No separate dental pricing tier.
