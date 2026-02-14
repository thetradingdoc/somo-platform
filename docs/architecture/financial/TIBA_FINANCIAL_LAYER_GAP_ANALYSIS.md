# Tiba Settlement Protocol – Gap Analysis

**Purpose:** Map the Tiba Settlement Protocol (mathematical spec) against DocLittle's current financial layer. Identify what exists, what's partial, and what needs to be built.

---

## 1. Deterministic Coding Function

### Tiba Spec: C_deterministic(E, P) → {(c_i, q_i, φ_i, f^P_i, n_i)}

| Field | Spec | Current State | Gap |
|-------|------|---------------|-----|
| **c_i** | CPT code | ✅ `cpt_codes`, `getCodeCandidates`, `runCodingPipeline` return codes | None |
| **q_i** | Quantity | ⚠️ Implicitly 1; not exposed per line | Add q_i to coding output |
| **φ_i** | Confidence per code | ✅ `confidence` in knowledge-service, coding-orchestrator, getCodeCandidates | None |
| **f^P_i** | Payer allowed amount | ✅ `FeeScheduleService.getAllowedAmount(payerId, cptCode)` | **Coding pipeline does not accept P** – no payer at coding time; pricing fetched later |
| **n_i** | Network indicator | ✅ `fee_schedules.in_network` | Not passed through coding → EOB flow per code |

### Tiba Spec: φ_i = min(φ^NLP_i, φ^rule_i, φ^historical_i)

| Component | Spec | Current State | Gap |
|-----------|------|---------------|-----|
| **φ^NLP_i** | NLP model confidence | ✅ `confidence` from getCodeCandidates, Groq output | None |
| **φ^rule_i** | Rule-based validation | ⚠️ `validateCodePair` exists but does not emit confidence; no rule-based confidence | Add rule-based confidence (e.g., simple-rule match = 1.0, validation pass = boost) |
| **φ^historical_i** | Historical acceptance rate | ❌ Not implemented | Build: track denial/accept per (code, payer) in coding_decisions or new table |

### Tiba Spec 2.4: Prior Authorization

| Requirement | Current State | Gap |
|-------------|---------------|-----|
| auth_i, φ_auth_cap | ❌ Not implemented | Add prior-auth requirement check per CPT; cap φ_i when missing |

---

## 2. Real-Time EOB (Section 3)

### Tiba Spec 3.2: Line-Item Responsibility

| Step | Spec | Current State (EOBCalculationService) | Gap |
|------|------|--------------------------------------|-----|
| **Step 1: a_i = min(f_i, f^P_i)** | Allowed amount | ✅ `resolveAllowedAmount` or billed * 0.85/0.70 | None |
| **Step 2: Deductible** | d_i, b_ded_remaining | ✅ Applied; `deductible_total`, `deductible_remaining` from eligibility | None |
| **Step 3: s_i = max(0, a_i - d_i - b_copay)** | Coinsurance base | ✅ `amountAfterDeductibleAndCopay = max(0, ...)` | None |
| **Step 4: r^patient_i** | Deductible + copay + coinsurance + balance billing | ⚠️ Copay applied once per claim, not per line; **balance billing (1-n_i)×(f_i-a_i) not implemented** | Add balance billing for out-of-network; clarify copay per-visit vs per-line |
| **Step 5: r^plan_i** | Plan responsibility | ✅ `planPaid` | None |
| **Step 6: OOP max cap** | b_oop_max, b_oop_met | ❌ **Not implemented** | Add b_oop_max, b_oop_met to eligibility; cap patient responsibility |

### Benefit Structure (271 Response)

| Field | Spec | eligibility_checks / Stedi | Gap |
|-------|------|---------------------------|-----|
| b_ded | Deductible total | ✅ deductible_total | None |
| b_ded_met | YTD met | ⚠️ Can derive from deductible_total - deductible_remaining | None |
| b_ded_remaining | Remaining | ✅ deductible_remaining | None |
| b_copay | Copay | ✅ copay_amount | None |
| b_coins | Coinsurance % | ✅ coinsurance_percent | None |
| b_oop_max | OOP maximum | ❌ Not in schema | Add oop_max column |
| b_oop_met | OOP met YTD | ❌ Not in schema | Add oop_met column |
| n | Network status | ⚠️ In fee_schedules, not in eligibility per se | Ensure passed to EOB |

### Temporal Consistency (Spec 3.4)

| Requirement | Current State | Gap |
|-------------|---------------|-----|
| Δ_i tolerance, auto-reconcile | ❌ Not implemented | Add post-adjudication comparison; flag when Δ > $10 or 5% |

---

## 3. Confidence-Weighted Settlement (Section 4)

### Tiba Spec: Φ_weighted, Φ_min, Φ = α×Φ_weighted + (1-α)×Φ_min

| Component | Current State | Gap |
|-----------|---------------|-----|
| Aggregate confidence | ❌ `computeOverallConfidence` uses min only; no weighted-by-financial | Implement Φ_weighted, Φ_min, α blend |
| Settlement thresholds θ_high, θ_low | ⚠️ MIN_CODING_CONFIDENCE=0.7 exists; no θ_high (0.95) | Add θ_high, θ_low, α as config |
| S(R_plan, Φ) | ❌ No settlement amount function | Implement full/partial/hold logic |

### Post-Adjudication Reconciliation (Spec 4.3)

| Requirement | Current State | Gap |
|-------------|---------------|-----|
| Δ_plan = final_R_plan − R_plan | ❌ Not implemented | Add reconciliation when 835/277 returns |
| Recover or release logic | ❌ Not implemented | Implement based on Δ_plan sign |

---

## 4. Smart Contract Escrow (Section 5)

| Component | Current State | Gap |
|-----------|---------------|-----|
| Escrow state machine | ❌ No escrow layer | Tiba escrow is blockchain; DocLittle uses Stripe/Circle – **out of scope** for current platform unless Tiba integration planned |
| Proof of care V(E,C,π) | ⚠️ coding_decisions logs codes; no doc hash, timestamp validation | Add proof-of-care verification if escrow needed |
| Provider trust score τ_provider | ❌ Not implemented | Add denial rate, coding variance, volume metrics |

---

## 5. Implementation Checklist (Spec Section 10)

| Check | Status |
|-------|--------|
| Coding returns (c_i, q_i, φ_i, f^P_i, n_i) | Partial – missing q_i, f^P_i at coding time, n_i in flow |
| Confidence = min(NLP, rule, historical) | Partial – no rule confidence, no historical |
| EOB: deductible, copay, coinsurance, OOP max | Partial – no OOP max |
| Network status, balance billing | Missing – balance billing not implemented |
| Aggregate confidence (weighted + min) | Missing |
| θ_high, θ_low, α configurable | Partial – only MIN_CONFIDENCE |
| Settlement S(R_plan, Φ) | Missing |
| Escrow/timeout (if applicable) | N/A for current architecture |
| Proof of care validation | Partial |
| Transaction cost modeling | Not in EOB layer |

---

## 6. Recommended Implementation Order

### Phase 1: EOB & Benefit Structure (Align with Tiba 3.2)
1. Add `oop_max`, `oop_met` to eligibility_checks and Stedi 271 parsing.
2. Implement OOP max cap in `EOBCalculationService.calculateEOB`.
3. Add balance billing `(1-n_i)×max(0, f_i - a_i)` for out-of-network.
4. Pass `inNetwork` per line item from fee schedule or eligibility.

### Phase 2: Deterministic Coding Output
1. Extend coding pipeline to accept optional `payerId`; when present, attach `f^P_i`, `n_i` per code.
2. Add `q_i` (quantity) to coding output (default 1).
3. Implement `φ^rule_i`: rule-match = 1.0, validateCodePair pass = no penalty.

### Phase 3: Confidence Aggregation & Settlement
1. Implement `computeAggregateConfidence(codes, eob)` using Φ_weighted and Φ_min.
2. Add env/config: `THETA_HIGH=0.95`, `THETA_LOW=0.70`, `ALPHA=0.7`.
3. Implement `computeSettlementAmount(R_plan, Φ)` → full, partial, or hold.

### Phase 4: Historical & Prior Auth (Lower Priority)
1. Track (code, payer) acceptance/denial in coding_decisions or new `code_acceptance_rates` table.
2. Add prior-auth requirement lookup per CPT; cap φ when auth missing.

### Phase 5: Post-Adjudication Reconciliation (When 835/277 Available)
1. On claim status/ERA: compare final vs real-time EOB.
2. Implement reconcile (release/recover) logic per spec 4.3.

---

## 7. Files to Modify (Summary)

| File | Changes |
|------|---------|
| `database.js` | Add oop_max, oop_met to eligibility_checks (migration) |
| `insurance-service.js` | Parse oop_max, oop_met from 271; pass to eligibility record |
| `eob-calculation-service.js` | OOP max cap; balance billing; inNetwork per line |
| `coding-orchestrator.js` | Accept payerId; return (c_i, q_i, φ_i); optionally attach f^P_i, n_i |
| `knowledge-service.js` | Add rule-based confidence component |
| **NEW** `settlement-service.js` | Aggregate confidence, S(R_plan, Φ), thresholds |
| `adjudication-service.js` | Call settlement-service; expose settlement decision |

---

*Created: February 2026. Use as technical reference for Tiba-aligned financial layer work.*
