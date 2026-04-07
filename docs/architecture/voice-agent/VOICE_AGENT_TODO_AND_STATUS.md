# Voice Agent — Todo & Implementation Status

**Last Updated:** April 6, 2026

Merged from: MEDICAL_CODING_AGENT_TODO, AI_AGENT_FINANCIAL_LAYER_TODO, IMPLEMENTATION_STATUS.

---

## 1. Implementation Status Summary

**Overall Maturity:** ~85% complete

| Layer | Completeness | Status |
|-------|--------------|--------|
| Infrastructure (DB, imports, search) | 100% | ✅ Production ready |
| State Management (LangGraph-style) | 100% | ✅ Production ready |
| Context Assembly (RAG) | 100% | ✅ Production ready |
| Safety (red flags, validation) | 80% | 🟡 Missing confidence thresholds |
| Tools (Retell functions) | 100% | ✅ All tools + caching |
| Memory & Audit | 100% | ✅ coding_decisions, snapshots |
| Evaluation | 80% | ✅ Framework + baseline; expand cases |
| Multi-Model | 0% | 🟢 Low priority |
| Monitoring | 90% | ✅ llm_usage_log, LangSmith |

---

## 2. Fully Implemented

- **State:** voice_call_states, voice_conversation_memory, agent_state_snapshots
- **RAG:** getCodeCandidates, context-assembler, ICD-10/CPT/HCPCS search
- **Tools:** search_icd10_codes, search_cpt_codes, search_hcpcs_codes, suggest_codes_from_symptoms, extract_medical_text, validate_code_pair, assess_urgency, check_payer_guidelines, get_code_pricing
- **Safety:** detectRedFlags, code existence validation, code-pair validation, emergency blocking
- **Financial:** triage-rules.json, medical abbreviations, FeeScheduleService (payerId in options)
- **Evaluation:** test-cases.json (~28), voice-agent-test-cases.json (6), evaluate-accuracy.js, evaluate-voice-agent.js
- **Caching:** in-memory (24h/7d/30d), cache-service, /api/admin/cache-stats

---

## 3. Pending / Partially Done

| Task | Status | Notes |
|------|--------|-------|
| Semantic search (OPENAI) | ❌ | embedText, hybridSearch exist; needs OPENAI_API_KEY + populated embeddings |
| Confidence thresholds | ⚠️ | MIN_CODING_CONFIDENCE=0.7; reject low-confidence suggestions |
| Expand test cases to 100+ | ❌ | Broader coverage |
| Latency budgets, P95 alerts | ❌ | Per-stage budgets |
| Multi-model router | ❌ | LOW – affects ~2% cost (PDF only); see MULTI_MODEL_REALITY_CHECK |
| CDT Dental | ❌ | Lower priority |

---

## 4. Cost Optimization Priority

| Priority | Focus | Savings |
|----------|-------|---------|
| 🔥 1 | Call duration (4→3 min) | ~$990/mo |
| 🔥 2 | Call deflection (20%) | ~$780/mo |
| 🟡 3 | Retell usage optimization | ~$390/mo |
| 🟢 4 | Multi-model | -$30/mo (only if accuracy gaps) |

---

## 5. Critical Order (Completed)

1. Phase 0 ✅ — Paths, CPT import, wire KB to voice
2. Phase 1 ✅ — State management
3. Phase 2 ✅ — ICD-10/HCPCS, RAG
4. Phase 3 ✅ — Tools, caching
5. Phase 5 ✅ — Memory, coding_decisions
6. Phase 6 ✅ — Safety, validation
7. Phase 7 ✅ — Evaluation framework

---

## 6. Related Docs

- [RUNBOOK.md](./RUNBOOK.md) — Imports, evaluation, troubleshooting
- [TOOL_SCHEMAS.md](./TOOL_SCHEMAS.md) — Tool definitions
- [MULTI_MODEL_REALITY_CHECK.md](./MULTI_MODEL_REALITY_CHECK.md) — Cost analysis
