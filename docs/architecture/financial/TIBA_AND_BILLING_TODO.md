# Tiba & Billing — Consolidated Todo

**Last Updated:** April 6, 2026

Merged from: Tiba Gap Analysis, Gap Remediation Todo, Tiba Detailed Todo, Backend Billing Review.

---

## 1. Tiba Alignment Summary

The Tiba Settlement Protocol defines deterministic coding (c_i, q_i, φ_i, f^P_i, n_i), EOB line-item responsibility, confidence-weighted settlement, and provider trust scores. See [TIBA_FINANCIAL_LAYER_GAP_ANALYSIS](#2-gap-analysis) (archived into this doc).

**Current State:**
- ✅ Coding returns codes, confidence; modifier rules, prior-auth checks exist
- ✅ EOB: deductible, copay, coinsurance, OOP max, balance billing
- ✅ Provider trust metrics table, settlement state persistence
- ⚠️ Historical confidence (φ^historical), post-adjudication reconciliation pending
- ❌ Escrow layer out of scope (Tiba uses blockchain; we use Stripe/Circle)

---

## 2. Gap Analysis (Tiba Spec Mapping)

### 2.1 Deterministic Coding (C_deterministic)

| Field | Status | Gap |
|-------|--------|-----|
| c_i (CPT) | ✅ | None |
| q_i (quantity) | ✅ | Default 1 per line |
| φ_i (confidence) | ✅ | min(NLP, rule); historical pending |
| f^P_i (payer allowed) | ✅ | When payerId at coding time |
| n_i (network) | ✅ | fee_schedules.in_network |
| Modifiers (-25, -59, -51) | ✅ | modifier-rules.json, getRequiredModifiers |
| Prior auth | ✅ | requiresPriorAuth, φ_auth_cap |

### 2.2 EOB (Section 3)

| Step | Status | Gap |
|------|--------|-----|
| Allowed amount, deductible, copay | ✅ | None |
| OOP max cap | ✅ | oop_max, oop_met in eligibility |
| Balance billing (OON) | ✅ | (1-n_i)×(f_i-a_i) |
| Temporal consistency (Δ_i) | ⚠️ | Post-adjudication comparison pending |

### 2.3 Settlement (Section 4)

| Component | Status | Gap |
|-----------|--------|-----|
| Φ_weighted, Φ_min, α | ⚠️ | MIN_CODING_CONFIDENCE only; add θ_high, θ_low |
| S(R_plan, Φ) | ⚠️ | Partial; full/partial/hold logic |
| Post-adjudication Δ_plan | ❌ | When 835/277 returns |
| Provider trust τ | ✅ | provider_trust_metrics |

---

## 3. Code Remediation (Priority Order)

### CRITICAL: Modifier Handling
- **Files:** knowledge-service.js, medical-coding-service.js, coding-orchestrator.js, eob-calculation-service.js
- **Logic:** E/M + procedure → -25; distinct procedures → -59; multiple surgery → -51
- **φ^modifier_i:** 0.60 if required modifier missing

### CRITICAL: Provider Trust Integration
- **DB:** provider_trust_metrics (npi, trust_score, denial_rate, etc.)
- **Files:** code-acceptance-service, settlement-service, adjudication-service
- **Logic:** Φ_effective = Φ × τ_provider; use in getSettlementDecision

### CRITICAL: Settlement State Persistence
- **DB:** insurance_claims + settlement_state, settlement_aggregate_confidence, settlement_amount_released, settlement_decision
- **Files:** adjudication-service, server.js claim APIs

### HIGH: NecessityRules Version Control
- **File:** code-pair-validation.json — add version, effective_date
- **knowledge-service:** getRuleVersionForDate, getRuleHash

### HIGH: Encounter Time Validation
- **File:** time-based-cpt-rules.json — CPT → min duration
- **knowledge-service:** validateCptDuration, computeTimeConfidence

---

## 4. Tiba Phase Checklist (Condensed)

### Phase 1: EOB & Benefits ✅
- [x] oop_max, oop_met in eligibility_checks
- [x] Stedi 271 parsing for OOP
- [x] OOP max cap in calculateEOB
- [x] Balance billing for out-of-network

### Phase 2: Deterministic Coding ✅
- [x] runCodingPipeline accepts payerId
- [x] q_i, f^P_i, n_i in output
- [x] computeRuleConfidence, φ^rule_i

### Phase 3+: Settlement, Reconciliation
- [ ] θ_high, θ_low config; S(R_plan, Φ) full logic
- [ ] Post-adjudication Δ_plan reconciliation
- [ ] Unit tests for EOB edge cases

---

## 5. Backend Billing API Review

### Tenant Scoping Issues

| Endpoint | Issue | Recommendation |
|----------|-------|----------------|
| `GET /api/admin/billing/eob` | No tenant filter | Add `GET /api/customer/billing/eob`; filter by merchant_id |
| `GET /api/invoices` | Scope check needed | Confirm getInvoices applies merchant filter |
| `GET /api/fhir/Patient` | Global resource | Filter by merchant_id if multi-tenant |
| `GET /api/claims/:id` | Verify ownership | Ensure claim belongs to requester's merchant |

### Route Inventory
- `/api/usage-monitor` — Credits, billing
- `/api/invoices` — invoices-clinic.js
- `/api/claims/*` — server.js inline
- `/api/pdf-coding` — PDF processing
- `/api/customer/billing` — Usage, checkout
- `/api/admin/billing` — EOB list (scope fix needed)

---

## 6. Implementation Order

1. **Modifier + Trust + Settlement** (CRITICAL block)
2. **NecessityRules + Time validation** (HIGH)
3. **Backend billing tenant scoping** (Security)
4. **Post-adjudication reconciliation** (Phase 4)
