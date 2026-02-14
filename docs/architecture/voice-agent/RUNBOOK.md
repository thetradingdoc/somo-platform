# Medical Coding Voice Agent – Runbook

Operational procedures for the medical coding voice agent.

---

## 1. Run ICD-10 / CPT / HCPCS Imports

All imports run from `middleware-platform/`:

```bash
cd middleware-platform
```

### ICD-10 (~72K codes)

**Source:** `Knowledge/ICD-10 Files/2020 Code Descriptions/icd10cm_codes_2020.txt`

```bash
node scripts/import-icd10-codes.js
```

### CPT (DHS addendum, ~1.3K codes)

**Source:** `Knowledge/CPT/2025_DHS_Code_List_Addendum_11_26_2024.xlsx`

```bash
node scripts/import-cpt-codes.js
```

*Note:* DHS addendum omits common E/M codes (99213, 99214). Use full CPT when available.

### HCPCS (~9K codes)

**Source:** `Knowledge/HCPCS/hcpc2026_jan_anweb_01122026/HCPC2026_JAN_ANWEB_01122026.txt`

```bash
node scripts/import-hcpcs-codes.js
```

### Semantic embeddings (optional)

Requires `OPENAI_API_KEY` in `.env`. Run after ICD-10/CPT/HCPCS imports:

```bash
node scripts/populate-code-embeddings.js [--limit N] [--type icd10|cpt|hcpcs]
```

---

## 2. Run Evaluation Suite

```bash
cd middleware-platform
node tests/medical-coding/evaluate-accuracy.js
```

Voice agent flow evaluation (extraction, triage, code retrieval):

```bash
node tests/medical-coding/evaluate-voice-agent.js
```

With LLM hallucination check (requires `GROQ_API_KEY`):

```bash
node tests/medical-coding/evaluate-accuracy.js --llm
```

With test database:

```bash
NODE_ENV=test node tests/medical-coding/evaluate-accuracy.js
```

Test cases: `tests/medical-coding/test-cases.json` (28 cases), `tests/medical-coding/voice-agent-test-cases.json` (6 voice flow cases).  
See `tests/medical-coding/README.md` for metrics and baseline.

---

## 3. Add New Coding Rules

### Code-pair validation (incompatible ICD-10 + CPT)

Edit `Knowledge/rules/code-pair-validation.json`:

```json
{
  "incompatible_pairs": [
    {
      "rule_id": "your_rule_id",
      "icd10_pattern": "^Z00",
      "cpt_pattern": "^99285",
      "reason": "Human-readable reason"
    }
  ]
}
```

- Patterns are regex; codes matched with or without dots (e.g. `Z00.129` or `Z00129`).
- Rules cached 30 days. After editing: restart or `POST /api/admin/cache/clear?bucket=coding_rules`.

### Simple coding rules (rule-based mapping)

Edit `Knowledge/rules/simple-coding-rules.json`. Format:

```json
{
  "match": { "appointment_type": "...", "diagnosis_keywords": ["..."] },
  "icd10": ["E11.9"],
  "cpt": ["99213"],
  "rationale": "Type 2 diabetes follow-up"
}
```

---

## 4. Cleanup & Retention

Voice call state data (including `coding_decisions`) is retained 30 days by default:

```bash
node scripts/cleanup-voice-call-state.js [days]
```

Example: 7-day retention:

```bash
node scripts/cleanup-voice-call-state.js 7
```

---

## 5. Medical Coding Tools (Retell)

Full schemas: `docs/architecture/voice-agent/TOOL_SCHEMAS.md`

| Tool | Purpose |
|------|---------|
| `search_icd10_codes` | Look up ICD-10 by symptom/condition |
| `search_cpt_codes` | Look up CPT by procedure |
| `search_hcpcs_codes` | Look up HCPCS (DME, supplies, modifiers) |
| `suggest_codes_from_symptoms` | Get ICD-10 + CPT from patient description; returns validated_pairs |
| `extract_medical_text` | Extract { symptoms, vitals, severity, temporal } from utterance |
| `assess_urgency` | Triage: EMERGENT / URGENT / ROUTINE (rule-based) |
| `validate_code_pair` | Check ICD-10 + CPT compatibility |
| `check_payer_guidelines` | Check if payer has fee schedule |
| `get_code_pricing` | Get allowed amounts for CPT codes |

---

## 6. Caching (Phase 3.3)

In-memory cache for code lookups and payer data. TTLs: code lookups 24h, payer guidelines 7d, coding rules 30d.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/admin/cache-stats` | Hit/miss counts, hit rate, cache size |
| `POST /api/admin/cache/clear?bucket=` | Clear cache. `bucket` optional: `code_lookup`, `payer_guidelines`, `payer_pricing`, `coding_rules`, `slot_availability` |

After bulk fee schedule upload or rule edits, clear the relevant bucket.

---

## 6.1 Latency Budgets (Phase 8.1)

| Stage | Max latency | P95 target |
|-------|-------------|------------|
| Triage (assess_urgency) | 500ms | 300ms |
| Code search (ICD-10/CPT/HCPCS) | 1s | 500ms |
| Code-pair validation | 200ms | 100ms |
| Full getCodeCandidates | 2s | 1.5s |

Env: `MIN_CODING_CONFIDENCE=0.7` (Phase 6.4) – suggestions below threshold route to manual review.

---

## 6.2 LangSmith Observability (Phase 8.2)

Medical coding Groq calls are traced to LangSmith when configured:

| Env Var | Purpose |
|---------|---------|
| `LANGSMITH_API_KEY` | LangSmith API key for tracing |
| `AP_Langchain` | Fallback for `LANGSMITH_API_KEY` (legacy) |
| `LANGCHAIN_TRACING_V2` | Set to `true` to enable (default when key present) |

Set in `.env`:
```
LANGSMITH_API_KEY=lsv2_pt_...
# or AP_Langchain=lsv2_pt_...
```

`llm_usage_log` tracks: operation, model, tokens_in, tokens_out, cost_usd, latency_ms, confidence_score.

`GET /api/admin/metrics?days=7` returns LLM aggregates and confidence distribution.

---

## 6.4 Medical Coding Voice Agent Prompt & Configure Retell

Append `docs/voice-agent/medical-voice-agent-prompt.md` to your Retell agent system prompt (Kelly) to enable the medical coding workflow: EXTRACT → TRIAGE → CODE → PRICE → VALIDATE.

**Configure Retell** (push prompt + functions to Retell):

```bash
cd middleware-platform
node configure-retell.js
```

Requires: server running on port 4000 (or `API_BASE_URL` in .env for production), `RETELL_API_KEY`, `RETELL_AGENT_ID` in `.env`. Script loads Kelly prompt from `docs/voice-agent/prompts/kelly-voice-agent-prompt.md`, appends `medical-voice-agent-prompt.md`, and updates the Retell agent with the combined prompt and function definitions.

---

## 7. Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| **"attempt to write a readonly database"** | Sandbox or DB path outside workspace | Run with full permissions; ensure DB dir is writable |
| **ICD-10 search returns few/empty results** | Using JSON fallback (271 codes) instead of DB | Run `import-icd10-codes.js`; verify `icd10_codes` table has ~72K rows |
| **CPT 99213 not found** | DHS addendum lacks common E/M codes | Expected; add full CPT source or relax test expectations |
| **Evaluation failures on code retrieval** | Missing phrase in `MEDICAL_PHRASES` or `PHRASE_EXPANSIONS` | Add phrase in `knowledge-service.js`; add expansion if DB description differs |
| **validate_code_pair always valid** | Rules file missing or invalid | Check `Knowledge/rules/code-pair-validation.json` exists and is valid JSON |
| **Stale data after rule/fee update** | Cache not invalidated | `POST /api/admin/cache/clear?bucket=coding_rules` or `payer_guidelines` |
| **Costs not updating** | Twilio/Retell API keys or call end webhook | Verify `fetchCallCosts` in `utils/cost-tracker.js`; check call end flow |

### Verify fee schedule

```bash
node -e "
const db = require('./database');
const rows = db.getFeeSchedulesByPayer?.('BCBS', 5) || [];
console.log('Fee schedules for BCBS:', rows.length);
"
```

### Verify DB counts

```bash
cd middleware-platform
node -e "
const db = require('./database');
console.log('ICD-10:', db.getIcd10CodesCount?.() ?? 'N/A');
console.log('CPT:', db.db?.prepare('SELECT COUNT(*) as n FROM cpt_codes').get()?.n ?? 'N/A');
console.log('HCPCS:', db.getHcpcsCodesCount?.() ?? 'N/A');
"
```

---

## 8. Cost Optimization Priority

Voice calls (Retell + Twilio) = 98% of cost. Our LLMs (PDF coding) = 2%.

| Priority | Focus | Savings |
|----------|-------|---------|
| 🔥 1 | Call duration (4→3 min) | ~$990/mo |
| 🔥 2 | Call deflection (20%) | ~$780/mo |
| 🟡 3 | Retell usage optimization | ~$390/mo |
| 🟢 4 | Multi-model | -$30/mo (accuracy only) |

### SMS Booking (Call Deflection P2)

Configure Twilio Phone Number SMS webhook to: `https://yoursite.com/sms/incoming`

Supported: BOOK, CANCEL, HOURS, HELP. Booking flow: pick date → pick slot → confirm.

See `docs/architecture/voice-agent/MULTI_MODEL_REALITY_CHECK.md` for full analysis.
