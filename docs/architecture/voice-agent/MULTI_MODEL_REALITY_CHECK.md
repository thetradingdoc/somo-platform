# Multi-Model Reality Check – Architecture & Cost Analysis

## Executive Summary

**Critical Finding**: Multi-model routing affects only **2% of total cost** (PDF coding). The voice agent uses Retell's LLM, not ours.

**Impact on Priorities**:
- ❌ **Previous**: Multi-model = 60% cost savings (HIGH priority)
- ✅ **Reality**: Multi-model = accuracy optimization only (LOW priority, conditional)

**New Focus**: Optimize voice call efficiency (98% of cost) before considering multi-model.

---

## Architecture Reality

### Voice Call Path (No Our LLMs) ✅

```
Patient → Retell (their LLM + ASR + TTS) → Calls our tools → Return data
                    ↑
                    We don't control or pay for this LLM
                    Cost: Built into Retell's $0.02/min
```

**Our Tools (All Deterministic)**:

| Tool | Handler | Implementation | LLM? |
|------|---------|----------------|------|
| `assess_urgency` | `handleAssessUrgency()` | triage-service.detectRedFlags() (regex) | ❌ No |
| `search_icd10_codes` | `handleSearchIcd10Codes()` | knowledge-service.searchIcd10Codes() (DB) | ❌ No |
| `search_cpt_codes` | `handleSearchCptCodes()` | db.searchCptCodes() (DB) | ❌ No |
| `search_hcpcs_codes` | `handleSearchHcpcsCodes()` | knowledge-service.searchHcpcsCodes() (DB) | ❌ No |
| `validate_code_pair` | `handleValidateCodePair()` | knowledge-service.validateCodePair() (rules) | ❌ No |
| `check_payer_guidelines` | `handleCheckPayerGuidelines()` | fee-schedule-service (DB) | ❌ No |
| `get_code_pricing` | `handleGetCodePricing()` | fee-schedule-service (DB) | ❌ No |

**Key Insight**: All voice tools are DB lookups, regex patterns, or rule-based. **Zero LLM calls.**

---

### PDF Coding Path (Our LLMs) ✅

```
PDF → extract text → coding-orchestrator → route by complexity
                                              │
                        ┌─────────────────────┼────────────┐
                        │                     │            │
                    SIMPLE                MODERATE     COMPLEX
                        │                     │            │
                        ▼                     ▼            ▼
               simple-coding-rules   knowledge-service  Groq
               (no LLM) ✅           (no LLM) ✅     Llama-3.3-70B
               ~40% of PDFs          ~40% of PDFs    ~20% of PDFs
               $0/PDF                $0/PDF          $0.05-0.15/PDF
```

**Only COMPLEX PDFs hit Groq**: ~20% × 20 PDFs/day × $0.10 = **$2/day = $60/month**

---

## Cost Breakdown (1,000 calls/day)

| Component | Daily Cost | Monthly Cost | % of Total |
|-----------|------------|--------------|------------|
| **Retell (voice)** | $80 | $2,400 | 59% |
| **Twilio (voice)** | $52 | $1,560 | 39% |
| **Our Groq (PDF)** | $2 | $60 | 2% |
| **Total** | **$134** | **$4,020** | 100% |

**Voice calls**: 98% of cost  
**Our LLMs**: 2% of cost

---

## Cost Optimization Priority Order

```
Priority 1: Call Duration (25% savings = $990/month) 🔥
Priority 2: Call Deflection (20% savings = $780/month) 🔥
Priority 3: Retell Usage (10% savings = $390/month) 🟡
Priority 4: Multi-Model (0% savings, +accuracy) 🟢
```

---

## When Multi-Model Makes Sense

**Decision Criteria**:
- Evaluation shows accuracy <90% on expanded test suite, AND
- Failure analysis shows LLM reasoning would help, AND
- Rule-based fixes cannot address the gaps

**Key Principle**: Only add LLM calls when deterministic methods fail.

---

## Anti-Patterns to Avoid

❌ **Don't**: Implement multi-model before measuring need  
✅ **Do**: Evaluate first, implement only if gaps found

❌ **Don't**: Optimize the 2% (PDF coding cost)  
✅ **Do**: Optimize the 98% (voice call efficiency)

❌ **Don't**: Assume multi-model = cost savings  
✅ **Do**: Recognize multi-model = accuracy optimization (with added cost)

---

## Baseline Evaluation Status

- **Overall accuracy**: 100% (28/28 cases)
- **Triage accuracy**: 100%
- **Code retrieval**: 100%
- **Code-pair validation**: 100%

**Implication**: Multi-model not needed for accuracy on current test suite.

---

*See VOICE_AGENT_TODO_AND_STATUS.md for revised roadmap and RUNBOOK.md for cost optimization details.*
