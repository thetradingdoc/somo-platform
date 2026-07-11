# Benefits precedence SSOT (MT-02)

> **Last updated:** 2026-07-10  
> **Implementation:** `middleware-platform/services/resolve-amount-due.js`  
> **Quote engine:** `middleware-platform/services/payer-quote-service.js` (`computeVisitQuote`)

## Purpose

Single documented precedence order for **patient amount due** at voice checkout and portal payment. All callers must use `resolveAmountDue` — do not read `eligibility_checks`, `plan_rules`, or `visit_pricing` directly in product paths.

## Precedence order (highest wins)

| Rank | Source | Condition | `status` | Notes |
|------|--------|-----------|----------|-------|
| 0 | — | Missing `patientId` and `sessionId` | `cannot_determine` | `notes: patient_or_session_required` |
| 1 | — | `providerId` or `locationId` set | `defer` | Phase 1 out-of-scope; front desk confirms |
| 2 | — | Payer class invalid | `cannot_determine` | From `classifyPayerContext` |
| 3 | `eligibility_checks` | Latest row has `eligibility_quality === 'hard_copay'` OR eligible with non-thin quality and valid copay | `hard_number` | Stedi 271 hard copay path |
| 4 | `eligibility_checks` | `eligibility_quality === 'thin'` or `'inactive'` | `thin` / `cannot_determine` | Blocks insured checkout fallback |
| 5 | `eligibility_checks` | `eligibility_quality === 'simulate'` | *skipped* | **M-01:** simulate does not short-circuit; falls through to plan_rules |
| 6 | `plan_rules` | `computeVisitQuote` returns `hard_number` | `hard_number` | Payer + plan + service code |
| 7 | `plan_rules` | `computeVisitQuote` returns `estimate` | `estimate` | Blocks portal checkout (pending verification) |
| 8 | `rcm_journeys` | `amount_due` on matching appointment | `hard_number` | Journey persistence |
| 9 | default | none matched | `cannot_determine` | No visit_pricing for insured paths |

## Simulate + CDT exception (M-02)

When the latest eligibility row is `simulate` **and** the service code is CDT (`/^D\d{4}$/i`), the simulate copay is ignored. Resolution continues to `plan_rules` with the spine CDT code so dental admin path quotes use payer rules, not a flat simulate amount.

## Checkout wrappers

### `resolvePatientCheckoutAmount`

1. Voice checkout hint amount (if > 0)
2. `resolveAmountDue` hard_number
3. Block if `thin` or `estimate`
4. Self-pay only: `visit_pricing` via `getEffectiveVisitPrice(clinicId, appointmentType)`

Insured paths **never** fall back to `visit_pricing`.

### `resolveCheckoutAmount`

1. Caller hint amount (if ≥ 0)
2. `resolveAmountDue` hard_number
3. Block `thin` / `estimate`
4. Optional `rcm_journeys.amount_due` by `journeyId`
5. Fail with `quote_required` when `requireHardNumber` (default true)

## Valid status values

From `VALID_STATUS` in `resolve-amount-due.js`:

`hard_number`, `estimate`, `cannot_determine`, `thin`, `self_pay`, `defer`

## Tests

| Test file | Coverage |
|-----------|----------|
| `__tests__/resolve-amount-due.test.js` | Core resolver |
| `__tests__/simulate-eligibility-precedence.test.js` | M-01 simulate → plan_rules |
| `__tests__/resolve-patient-checkout-amount.test.js` | Portal checkout |
| `__tests__/payer-class-routing.test.js` | Payer class gate |

## Related docs

- [ARCHITECTURE.md](./ARCHITECTURE.md) — RCM money path
- [OPERATIONS.md](./OPERATIONS.md) — benefit ingest (`import-plan-rules-benefits.cjs`)
