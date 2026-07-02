# Copay settlement model (Phase 2 decision)

**Decision (pilot):** Somo **platform collects** copay via Stripe on the patient pay link; provider settlement is manual/periodic until Stripe Connect is enabled.

| Model | Pilot | Day 60+ |
|-------|-------|---------|
| Platform collects (Stripe PI → Somo) | **Yes** | Optional Connect |
| Stripe Connect direct to office | No | Evaluate per contract |

**Fee SSOT:** `services/platform-fee-config.js`

- Voice/copay checkout: `PLATFORM_FEE_PCT` or `COPAY_PLATFORM_FEE_PCT` (default 20%)
- Instant settlement / claims: `SETTLEMENT_PLATFORM_FEE_PERCENT` (default 3%)

**Implication:** Copay revenue share is configured separately from claims settlement take-rate — do not conflate `PLATFORM_FEE_PCT` with `PLATFORM_FEE_PERCENT`.
