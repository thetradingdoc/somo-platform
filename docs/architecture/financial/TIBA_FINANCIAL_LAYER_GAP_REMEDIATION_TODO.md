# Tiba Financial Layer – Gap Remediation Todo (Code Updates)

**Source:** Review against Tiba mathematical specification  
**Purpose:** Concrete code changes to close identified gaps  
**Priority:** CRITICAL → HIGH → MEDIUM

---

## CRITICAL: Modifier Handling (Tiba Spec 2.2, 2.5)

### Files to Create

| File | Action |
|------|--------|
| `Knowledge/rules/modifier-rules.json` | CREATE – Define CPT combinations requiring -25, -59, -51 and rules |

### Files to Modify

| File | Changes |
|------|---------|
| `middleware-platform/services/knowledge-service.js` | Add `loadModifierRules()`, `getRequiredModifiers(cptList)`, `validateModifiers(cptList)`, `computeModifierConfidence(cptList, modifiers)`; export new functions |
| `middleware-platform/services/medical-coding-service.js` | Add modifier inference in prompt: "Include modifiers when E/M + procedure (-25), distinct procedures (-59), multiple surgery (-51)"; parse modifiers from Groq JSON output |
| `middleware-platform/services/coding-orchestrator.js` | Add `applyModifierConfidence(cpt)`; integrate after `applyPriorAuthCap`; extend `withConfidence` to preserve `modifiers: []` per CPT; φ^modifier_i: missing required = 0.60 |
| `middleware-platform/services/pdf-coding-service.js` | Ensure `modifiers` passed through in getCPTPricing output and pricing.breakdown |
| `middleware-platform/services/eob-calculation-service.js` | Pass modifiers to line items when building from pricing.breakdown (for claim submission) |

### Logic to Implement

- **Modifier rules:** E/M (99202-99215) + procedure (e.g. 12001) → require -25 on E/M
- **Modifier rules:** Multiple distinct procedures same day → require -59 on secondary
- **Modifier rules:** Multiple surgery (reduced payment) → require -51 on secondary
- **φ^modifier_i:** If `getRequiredModifiers(cptList)` returns missing mods and not present on codes → 0.60; else 1.0

---

## CRITICAL: Provider Trust Score Integration (Tiba Spec 5.5, 5.6)

### Files to Create

| File | Action |
|------|--------|
| — | Add migration in database.js for `provider_trust_metrics` table |

### Database Migration

```sql
CREATE TABLE IF NOT EXISTS provider_trust_metrics (
  provider_npi TEXT PRIMARY KEY,
  trust_score REAL DEFAULT 1.0,
  denial_rate REAL DEFAULT 0,
  coding_variance REAL DEFAULT 0,
  volume_anomaly_score REAL DEFAULT 0,
  last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Files to Modify

| File | Changes |
|------|---------|
| `middleware-platform/database.js` | Add migration; `upsertProviderTrustMetric(npi, updates)`, `getProviderTrustScore(npi)` |
| `middleware-platform/services/code-acceptance-service.js` | Add `updateProviderTrustScore(providerNpi, claimOutcome)`; τ(t+1) = 0.9×τ(t) + 0.1×acceptance |
| `middleware-platform/services/settlement-service.js` | Add `getEffectiveConfidence(phi, providerNpi)` → Φ_effective = Φ × τ_provider; in `getSettlementDecision` use Φ_effective for thresholds |
| `middleware-platform/services/adjudication-service.js` | Pass `providerNpi` (from claim or appointment) to `getSettlementDecision` |
| `middleware-platform/services/insurance-service.js` | On claim status approved/denied: call `updateProviderTrustScore` with provider NPI if available |

### Logic

- Default τ_provider = 1.0 when no record
- `computeSettlementAmount(R_plan, phiEffective, config)` – use Φ_effective not Φ

---

## CRITICAL: Settlement State Persistence (Tiba Spec 5.1)

### Database Migration

```sql
ALTER TABLE insurance_claims ADD COLUMN settlement_state TEXT;  -- 'pending'|'verified'|'rejected'
ALTER TABLE insurance_claims ADD COLUMN settlement_aggregate_confidence REAL;
ALTER TABLE insurance_claims ADD COLUMN settlement_amount_released REAL;
ALTER TABLE insurance_claims ADD COLUMN settlement_escrow_remainder REAL;
ALTER TABLE insurance_claims ADD COLUMN settlement_decision TEXT;  -- JSON
```

### Files to Modify

| File | Changes |
|------|---------|
| `middleware-platform/database.js` | Migration; extend `updateInsuranceClaim` for new columns |
| `middleware-platform/services/adjudication-service.js` | In `runAdjudication`, after `getSettlementDecision`: call `db.updateInsuranceClaim(claim.id, { settlement_state: 'pending', settlement_aggregate_confidence, settlement_amount_released, settlement_escrow_remainder, settlement_decision: JSON.stringify(...) })` |
| `middleware-platform/server.js` | Expose settlement_state, settlement_decision in claim APIs (GET /api/claims/:id, pre-adjudicate response) |

---

## HIGH: NecessityRules Version Control (Tiba Spec 5.4)

### Files to Modify

| File | Changes |
|------|---------|
| `Knowledge/rules/code-pair-validation.json` | Add `version`, `effective_date`, wrap existing in `rules`; e.g. `{ "version": "2026-Q1", "effective_date": "2026-01-01", "incompatible_pairs": [...], ... }` |
| `middleware-platform/services/knowledge-service.js` | Add `getRuleVersionForDate(date)`, `getRuleHash()` (SHA256 of rules JSON); log rule_version in validation |
| `middleware-platform/database.js` | Add `rule_version`, `rule_hash` to `coding_decisions` if table exists; else document for future |

---

## HIGH: Encounter Time Validation (Tiba Spec 2.2)

### Files to Create

| File | Action |
|------|--------|
| `Knowledge/rules/time-based-cpt-rules.json` | CREATE – Map CPT to min duration; e.g. 90837→53, 90834→38, 90832→16 |

### Files to Modify

| File | Changes |
|------|---------|
| `middleware-platform/services/knowledge-service.js` | Add `loadTimeBasedCptRules()`, `validateCptDuration(cptCode, durationMinutes)`; return pass/fail |
| `middleware-platform/services/coding-orchestrator.js` | In `applyRuleConfidence` or new `applyTimeConfidence`: if duration doesn't meet CPT requirement, φ^time_i = 0.60 |
| `middleware-platform/services/coding-orchestrator.js` | Accept `encounter_start_time`, `encounter_end_time` in encounter; compute `durationMinutes` or use provided |

### Logic

- 90837: min 53 min; 90834: min 38 min; 90832: min 16 min (per CMS)
- If `durationMinutes < required`: cap confidence at 0.60

---

## HIGH: Real-Time Plan Paid Storage Verification (Phase 5)

### Files to Verify

| File | Verify |
|------|--------|
| `middleware-platform/services/adjudication-service.js` | ✅ Already persists `real_time_plan_paid` in `preAdjudicateClaim` – CONFIRMED |
| `middleware-platform/services/insurance-service.js` | ✅ Already runs reconciliation on approved/paid – CONFIRMED |

### Optional Enhancements

| File | Change |
|------|--------|
| `middleware-platform/server.js` | When claim created via PDF coding flow: run pre-adjudication and persist real_time_plan_paid if not already done |
| `middleware-platform/database.js` | Ensure `updateInsuranceClaim` supports `real_time_plan_paid` – ✅ DONE |

---

## MEDIUM: Proof-of-Care Hash (Tiba Spec 5.3, 5.4) — DEFER if no blockchain

### Files to Modify (only if blockchain escrow planned)

| File | Changes |
|------|---------|
| `middleware-platform/database.js` | Add `proof_of_care_hash` to insurance_claims |
| `middleware-platform/services/settlement-service.js` | Add `generateProofOfCare(encounterNotes, codes, timestamp)` → SHA256 hash |
| Claim creation flow | Before submit: generate and store proof_of_care_hash |

---

## Summary: Code Files to Touch

| Priority | Files |
|----------|-------|
| **CRITICAL** | modifier-rules.json (new), knowledge-service.js, medical-coding-service.js, coding-orchestrator.js, pdf-coding-service.js, database.js, code-acceptance-service.js, settlement-service.js, adjudication-service.js, insurance-service.js |
| **HIGH** | code-pair-validation.json, knowledge-service.js, time-based-cpt-rules.json (new), coding-orchestrator.js |
| **MEDIUM** | database.js, settlement-service.js (proof-of-care – defer) |

---

## Recommended Implementation Order

1. Modifier handling (biggest denial risk)
2. Settlement state persistence (audit/compliance)
3. Provider trust score integration (capital efficiency)
4. NecessityRules versioning
5. Encounter time validation
6. Proof-of-care (only if blockchain)

---

*Created: February 2026. Code-level remediation list.*
