# Provider Trust Score Probationary Period

## Overview

New providers start with a default trust score of `τ = 0.5` (configurable via `DEFAULT_PROVIDER_TRUST_SCORE`). This creates an intentional probationary period where all claims require manual review.

## How It Works

**Formula**: `Φ_effective = Φ × τ_provider`

**Example**:
- New provider submits claim with coding confidence `Φ = 0.95`
- Trust score `τ = 0.5` (default for new providers)
- Effective confidence: `Φ_effective = 0.95 × 0.5 = 0.475`
- Settlement threshold: `THETA_LOW = 0.70`
- Result: `0.475 < 0.70` → **Decision: HOLD** (requires manual review)

## Provider Onboarding Communication

**Must communicate to new providers**:

> "Your first N claims will require manual review to establish trust scores. This is a standard security measure to prevent fraud. Once your trust score is established (typically after 10-20 successful claims), claims will be auto-approved when coding confidence is high."

## Trust Score Establishment

Trust scores are updated when:
- Claims are approved/paid → trust score increases
- Claims are denied → trust score decreases
- Fraud flags → trust score decreases significantly

**Typical timeline**: 10-20 successful claims before trust score reaches `τ ≥ 0.8` (enabling auto-approval for high-confidence claims).

## Configuration

```bash
# Default trust score for new providers (0.0 - 1.0)
DEFAULT_PROVIDER_TRUST_SCORE=0.5

# Minimum trust score for auto-approval (optional)
MIN_TRUST_FOR_AUTO_APPROVAL=0.8
```

## FAQ

**Q: Why not start at τ = 1.0?**  
A: Prevents new providers from gaming early claims to build trust artificially.

**Q: How long does probation last?**  
A: Until trust score reaches threshold (typically 10-20 successful claims).

**Q: Can we skip probation for verified providers?**  
A: Yes - manually set `trust_score = 0.8` in `provider_trust_metrics` table for pre-verified providers.

---

*Last Updated: February 2026*
