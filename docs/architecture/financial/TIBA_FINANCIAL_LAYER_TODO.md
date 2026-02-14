# Tiba Financial Layer – Detailed Todo List

**Source:** Tiba Settlement Protocol (Mathematical Specification)  
**Reference:** [TIBA_FINANCIAL_LAYER_GAP_ANALYSIS.md](./TIBA_FINANCIAL_LAYER_GAP_ANALYSIS.md)  
**Status:** Pre-implementation checklist

---

## Phase 1: EOB & Benefit Structure (Tiba Spec 3.2)

### 1.1 Database Schema

- [x] **Add oop_max column to eligibility_checks**
  - File: `middleware-platform/database.js`
  - Migration: `ALTER TABLE eligibility_checks ADD COLUMN oop_max REAL`
  - Default: null (optional from 271)
  - Document in schema comment

- [x] **Add oop_met column to eligibility_checks**
  - File: `middleware-platform/database.js`
  - Migration: `ALTER TABLE eligibility_checks ADD COLUMN oop_met REAL`
  - Default: 0 (amount patient has paid toward OOP YTD)
  - Document in schema comment

- [x] **Add in_network column to eligibility_checks** (if not present)
  - Fallback: use fee_schedule.in_network per CPT when building EOB (implemented)

### 1.2 Insurance Service (271 Parsing)

- [x] **Parse oop_max from Stedi 271 response**
  - File: `middleware-platform/services/insurance-service.js`
  - In `checkEligibility` flow: extract OOP max from parsed 271 (plan_summary or benefit segments)
  - Map to `eligibilityRecord.oop_max`
  - Document Stedi 271 segment mapping (e.g., III segment, OOP max element)

- [x] **Parse oop_met from Stedi 271 response**
  - Extract YTD amount met toward OOP max
  - Map to `eligibilityRecord.oop_met`
  - Default to 0 if not present

- [x] **Update eligibility record creation**
  - Ensure `createEligibilityCheck` / INSERT includes oop_max, oop_met
  - File: `middleware-platform/database.js` or `insurance-service.js`

- [x] **Update _simulateEligibilityCheck fallback**
  - Add mock oop_max, oop_met when Stedi unavailable
  - Example: oop_max=5000, oop_met=0 for simulation

### 1.3 EOB Calculation Service

- [x] **Add OOP max cap to calculateEOB**
  - File: `middleware-platform/services/eob-calculation-service.js`
  - Extract `oop_max`, `oop_met` from eligibility param
  - After computing r^patient_i per line: track cumulative patient owe
  - When `b_oop_met + r^patient_i > b_oop_max`:
    - excess = (b_oop_met + r^patient_i) - b_oop_max
    - r^patient_i -= excess
    - r^plan_i += excess
    - b_oop_met = b_oop_max
  - Skip cap when oop_max is null/undefined (plan may not have OOP)
  - Ref: Tiba spec Step 6

- [x] **Implement balance billing for out-of-network**
  - Add `inNetwork` per line item (from fee_schedule or eligibility default true)
  - Balance billing: `(1 - n_i) * max(0, f_i - a_i)` added to r^patient_i
  - In-network (n_i=1): no balance billing
  - Out-of-network (n_i=0): patient pays excess of billed over allowed
  - Ref: Tiba spec Step 4, r^patient_i formula

- [x] **Pass inNetwork to each line item**
  - When building line items: fetch in_network from fee_schedules for (payer_id, cpt_code)
  - If no fee schedule row: default inNetwork=true
  - Add `inNetwork` to processedLineItems output for audit

- [x] **Clarify copay application**
  - Document: copay is per-visit (apply once per claim) vs per-service
  - Tiba spec uses b_copay in s_i = max(0, a_i - d_i - b_copay) – implies per-line possible
  - Decision: keep per-claim copay (common in practice); add comment referencing spec

- [x] **Enforce s_i = max(0, a_i - d_i - b_copay)**
  - Verify no negative coinsurance base (already present; validate edge cases)

- [ ] **Unit tests for EOB**
  - Test: OOP max caps patient responsibility correctly
  - Test: Balance billing only when out-of-network
  - Test: In-network with high billed amount: no balance billing

### 1.4 Documentation

- [x] **Update FINANCIAL_LAYER_ARCHITECTURE.md**
  - Add oop_max, oop_met to eligibility/benefit structure table
  - Document balance billing formula
  - Update EOB flow diagram if needed

- [x] **Update TIBA_FINANCIAL_LAYER_GAP_ANALYSIS.md**
  - Phase 1 complete

---

## Phase 2: Deterministic Coding Output (Tiba Spec 2.2)

### 2.1 Coding Pipeline – Payer and Quantity

- [x] **Extend runCodingPipeline to accept optional payerId**
  - File: `middleware-platform/services/coding-orchestrator.js`
  - Signature: `runCodingPipeline(encounter, options = {})`
  - options: `{ payerId, dateOfService }`
  - When payerId present: fetch f^P_i, n_i per CPT from FeeScheduleService

- [x] **Add quantity (q_i) to coding output**
  - Each CPT in result: `{ code, description, confidence, quantity: 1 }` (default 1)
  - For future: support q_i > 1 for multiple units (e.g., injections)
  - File: `coding-orchestrator.js`, `medical-coding-service.js`

- [x] **Attach f^P_i and n_i when payerId provided**
  - After getting CPT list: call `FeeScheduleService.getAllowedAmountsForCodes(payerId, cptCodes, dateOfService)`
  - For each CPT: add `allowed_amount: f^P_i`, `in_network: n_i` (from fee_schedules or default true)
  - File: `coding-orchestrator.js`

### 2.2 Rule-Based Confidence (φ^rule_i)

- [x] **Add computeRuleConfidence to knowledge-service**
  - File: `middleware-platform/services/knowledge-service.js`
  - `computeRuleConfidence(icd10, cpt)`:
    - If matchSimpleRule returned for this encounter: return 1.0
    - If validateCodePair(icd10, cpt).valid: return 1.0 (no penalty)
    - If validateCodePair invalid: return 0 (or low cap)
  - Used as φ^rule_i in composite confidence

- [x] **Integrate φ^rule_i into coding output**
  - In coding-orchestrator: for each code pair, call computeRuleConfidence
  - Final φ_i = min(φ^NLP_i, φ^rule_i) for now (historical comes in Phase 4)
  - File: `coding-orchestrator.js`

### 2.3 Callers of Coding Pipeline

- [x] **Update CodingOrchestrator callers to pass payerId when available**
  - `runCodingPipeline` in: `pdf-coding-service.js`, `adjudication-service` (if used), any claim-creation flow
  - When claim has payer_id: pass into runCodingPipeline

- [x] **Update PDF coding to accept payerId in options**
  - File: `middleware-platform/services/pdf-coding-service.js`
  - processPDF(options): already has payerId for pricing; pass to runCodingPipeline when present

### 2.4 Documentation

- [x] **Document deterministic coding output format**
  - In FINANCIAL_LAYER_ARCHITECTURE.md or new CODING_OUTPUT_SPEC.md
  - Format: `{ c_i, q_i, φ_i, f^P_i?, n_i? }` per code

### 2.5 Modifier Handling (CRITICAL – Tiba Spec 2.2, 2.5)

- [ ] **Create `Knowledge/rules/modifier-rules.json`**
  - E/M + procedure → -25; distinct procedures → -59; multiple surgery → -51

- [ ] **Add modifier inference to MedicalCodingService**
  - File: `medical-coding-service.js`
  - Prompt: include modifiers when applicable; parse from Groq output

- [ ] **Extend runCodingPipeline output: `modifiers: []` per CPT**
  - File: `coding-orchestrator.js`
  - Add `applyModifierConfidence`; φ^modifier_i = 0.60 when required modifier missing

- [ ] **Add KnowledgeService.validateModifiers, getRequiredModifiers**
  - File: `knowledge-service.js`

### 2.6 Encounter Time Validation (Tiba Spec 2.2)

- [ ] **Create `Knowledge/rules/time-based-cpt-rules.json`**
  - 90837→53min, 90834→38min, 90832→16min

- [ ] **Add time-based validation to coding pipeline**
  - File: `knowledge-service.js`, `coding-orchestrator.js`
  - If duration < required: φ^time_i = 0.60

---

## Phase 3: Confidence Aggregation & Settlement (Tiba Spec 4)

### 3.1 Settlement Service (New)

- [x] **Create settlement-service.js**
  - File: `middleware-platform/services/settlement-service.js`
  - Exports: `computeAggregateConfidence`, `computeSettlementAmount`, `getSettlementDecision`

- [x] **Implement computeAggregateConfidence(codes, eob)**
  - Input: codes with confidence + quantity; eob with line items (plan paid per line)
  - Φ_weighted = Σ(φ_i × r^plan_i) / R_plan
  - Φ_min = min(φ_1, ..., φ_n)
  - Φ = α × Φ_weighted + (1 - α) × Φ_min
  - Default α = 0.7 (configurable)
  - Return { aggregate, weighted, min }
  - Edge case: R_plan = 0 → return Φ_min or 0

- [x] **Implement computeSettlementAmount(R_plan, Φ, config)**
  - Config: θ_high (default 0.95), θ_low (default 0.70)
  - If Φ ≥ θ_high: return { amount: R_plan, decision: 'full', escrowRemainder: 0 }
  - If θ_low ≤ Φ < θ_high: return { amount: R_plan * Φ, decision: 'partial', escrowRemainder: R_plan * (1 - Φ) }
  - If Φ < θ_low: return { amount: 0, decision: 'hold', escrowRemainder: R_plan }
  - Ref: Tiba spec 4.2

- [x] **Implement getSettlementDecision(claim, codingResult, eob)**
  - Build codes array from codingResult (icd10 + cpt with confidence)
  - Get R_plan from eob.totals.planPaid
  - Call computeAggregateConfidence, computeSettlementAmount
  - Return { decision, amount, escrowRemainder, aggregateConfidence }

### 3.2 Configuration

- [x] **Add settlement config env vars**
  - THETA_HIGH (default 0.95)
  - THETA_LOW (default 0.70)
  - ALPHA (default 0.7)
  - File: `settlement-service.js` or central config

### 3.3 Adjudication Integration

- [x] **Integrate settlement-service into adjudication**
  - File: `middleware-platform/services/adjudication-service.js`
  - runAdjudication: when codingResult available, call getSettlementDecision
  - Add to preAdjudication output: settlementDecision, aggregateConfidence
  - preAdjudicateClaim: ensure coding is run (or use claim response_data) before settlement

- [x] **Expose settlement decision in pre-adjudication API**
  - GET /api/claims/:claimId/pre-adjudicate (or equivalent)
  - Response includes: settlementDecision: { decision, amount, aggregateConfidence }

### 3.4 Database (Optional – Audit)

- [ ] **Add settlement_decision to insurance_claims or new audit table**
  - Store: claim_id, aggregate_confidence, decision, amount_released, escrow_remainder, created_at
  - For audit trail and reconciliation

### 3.5 Documentation

- [x] **Document settlement logic in FINANCIAL_LAYER_ARCHITECTURE.md**
  - Add section: Confidence-Weighted Settlement
  - Include formulas, thresholds, decision states

### 3.6 NecessityRules Version Control (Tiba Spec 5.4)

- [ ] **Add version tracking to code-pair-validation.json**
  - Format: `{ version, effective_date, rules }`; generate merkle hash

- [ ] **Store rule_version in coding_decisions**
  - File: `database.js`, `knowledge-service.js`
  - `getRuleVersionForDate(date)` for historical lookup

### 3.7 Provider Trust Score Integration (Tiba Spec 5.5, 5.6)

- [ ] **Create provider_trust_metrics table**
  - Columns: provider_npi, trust_score, denial_rate, last_updated

- [ ] **Implement SettlementService.getEffectiveConfidence**
  - Φ_effective = Φ × τ_provider
  - Use Φ_effective for settlement thresholds

- [ ] **Update provider trust after claim adjudication**
  - File: `code-acceptance-service.js`

### 3.8 Settlement State Persistence (Tiba Spec 5.1)

- [ ] **Add settlement columns to insurance_claims**
  - settlement_state, settlement_aggregate_confidence, settlement_amount_released, settlement_escrow_remainder, settlement_decision

- [ ] **Persist settlement decision in preAdjudicateClaim**
  - File: `adjudication-service.js`

---

## Phase 4: Historical & Prior Auth (Lower Priority)

### 4.1 Historical Acceptance (φ^historical_i)

- [x] **Design code_acceptance_rates table (or use coding_decisions)**
  - Columns: payer_id, cpt_code, icd10_code?, acceptance_count, denial_count, last_updated
  - Or: aggregate from coding_decisions + claim status

- [x] **Implement trackCodeOutcome(claimId, codes, status)**
  - On claim status = approved/denied: update acceptance/denial counts per (payer, code)
  - File: new `code-acceptance-service.js` or in insurance-service

- [x] **Implement getHistoricalConfidence(payerId, cptCode)**
  - Return acceptance_rate = acceptance_count / (acceptance_count + denial_count)
  - Default 1.0 when no history
  - Use as φ^historical_i

- [x] **Integrate φ^historical_i into confidence**
  - φ_i = min(φ^NLP_i, φ^rule_i, φ^historical_i)
  - In coding-orchestrator or settlement-service

### 4.2 Prior Authorization (Spec 2.4)

- [x] **Create prior-auth-rules.json or DB table**
  - List CPT codes that require prior auth (e.g., certain imaging, procedures)
  - Format: { cpt_code, requires_auth: true }

- [x] **Implement requiresPriorAuth(cptCode)**
  - Lookup in prior-auth rules
  - File: `knowledge-service.js` or new `prior-auth-service.js`

- [x] **Add auth_i to claim/coding flow**
  - When creating claim: check if auth on file (future: integrate with auth API)
  - If required and auth_i = 0: φ_i = min(φ_i, φ_auth_cap) where φ_auth_cap = 0.60

- [x] **Document prior-auth constraint**
  - In TIBA_FINANCIAL_LAYER_GAP_ANALYSIS and architecture docs

---

## Phase 5: Post-Adjudication Reconciliation (Spec 4.3)

### 5.1 Claim Status / ERA Parsing

- [x] **Parse final plan paid from 835 ERA or 277 response**
  - When claim status returns: extract final_R_plan (total plan paid)
  - File: `insurance-service.js` or claim status handler

- [x] **Store real-time R_plan at claim creation**
  - When claim submitted: save preAdjudication.estimatedPlanPaid as real_time_plan_paid
  - Requires column: `insurance_claims.real_time_plan_paid` or in response_data

### 5.2 Reconciliation Logic

- [x] **Implement computeReconciliation(claim)**
  - Δ_plan = final_R_plan - real_time_R_plan
  - If Δ_plan < 0: recover from escrow/provider
  - If Δ_plan > 0: release additional to provider
  - Patient funds never retroactively adjusted
  - File: `settlement-service.js` or new `reconciliation-service.js`

- [x] **Add reconciliation workflow**
  - On claim status update: trigger reconciliation if final amounts available
  - Log reconciliation events for audit

### 5.3 Temporal Consistency (Spec 3.4)

- [x] **Implement tolerance check**
  - δ_abs = $10, δ_pct = 5%
  - If |Δ_i| ≤ δ_abs OR |Δ_i|/a_i ≤ δ_pct: auto-reconcile
  - Else: flag for manual reconciliation
  - File: reconciliation logic

---

## Phase 6: Provider Trust & Proof of Care (Spec 5.3.1)

### 6.1 Provider Trust Score (Optional)

- [ ] **Design provider_trust_metrics table**
  - Columns: provider_id, denial_rate, coding_variance, volume_anomaly_score, trust_score, updated_at

- [ ] **Implement updateProviderTrustScore(providerId)**
  - Compute from: denial rate, coding variance, volume
  - effective_Φ = Φ × τ_provider for settlement

### 6.2 Proof of Care (Optional – Escrow Integration)

- [ ] **Implement verifyProofOfCare(encounter, codes, proof)**
  - checkEncounterComplete, verifyDocHash, validateTimestamps, checkPatientConsent, validateMedicalNecessity
  - Only needed if Tiba escrow/smart contract integrated
  - Defer unless explicitly scoped

---

## Phase 7: Testing & Validation

### 7.1 Unit Tests

- [ ] **EOB unit tests**
  - OOP max cap scenarios
  - Balance billing (in vs out of network)
  - Deductible, copay, coinsurance combinations
  - File: `middleware-platform/tests/eob-calculation-service.test.js` or similar

- [ ] **Settlement unit tests**
  - Φ calculation (weighted, min, blend)
  - S(R_plan, Φ) for each decision branch
  - Edge: R_plan=0, single code, all low confidence

- [ ] **Coding pipeline tests**
  - With payerId: returns f^P_i, n_i
  - Quantity in output
  - Rule confidence integration

### 7.2 Integration Tests

- [ ] **End-to-end: claim → EOB → settlement**
  - Create claim with coding, eligibility, line items
  - Run adjudication
  - Verify settlement decision matches expectations

### 7.3 Tiba Spec Validation Checklist

- [ ] Re-run [Implementation Validation Checklist](TIBA_FINANCIAL_LAYER_GAP_ANALYSIS.md#5-implementation-checklist) after implementation
- [ ] All items marked complete where applicable

---

## Summary by Phase

| Phase | Tasks | Est. Effort |
|-------|-------|-------------|
| Phase 1: EOB & Benefits | 15 | 1–2 days |
| Phase 2: Deterministic Coding | 10 | 1 day |
| Phase 3: Settlement | 12 | 1–2 days |
| Phase 4: Historical & Prior Auth | 8 | 1 day |
| Phase 5: Reconciliation | 6 | 0.5–1 day |
| Phase 6: Trust & Proof (Optional) | 3 | Defer |
| Phase 7: Testing | 10 | 1 day |

**Total (Phases 1–5 + 7):** ~61 tasks, ~6–8 days focused work

---

## Dependencies

```
Phase 1 ──────────────────────────► (foundation for all)
   │
   └──► Phase 2 (coding needs EOB structure for settlement)
            │
            └──► Phase 3 (settlement needs coding + EOB)
                     │
                     └──► Phase 5 (reconciliation needs settlement + claim status)
Phase 4 ──► (independent; improves Phase 3 inputs)
Phase 6 ──► (optional; depends on Phase 3)
Phase 7 ──► (throughout; run after each phase)
```

---

*Created: February 2026. Do not implement until this todo is reviewed and approved.*

---

## Gap Remediation Reference

See **[TIBA_FINANCIAL_LAYER_GAP_REMEDIATION_TODO.md](./TIBA_FINANCIAL_LAYER_GAP_REMEDIATION_TODO.md)** for detailed code-level changes (modifiers, provider trust, settlement state, necessity versioning, encounter time validation).
