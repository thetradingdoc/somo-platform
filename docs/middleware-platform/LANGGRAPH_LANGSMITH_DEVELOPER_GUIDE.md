# LangGraph, LangSmith & LLM Tracing — Developer Guide

This guide helps developers work with the LangGraph state machine, LangSmith tracing, and related scripts.

## Quick Reference

| Component | Location | Purpose |
|-----------|----------|---------|
| **LangSmith config** | `utils/langsmith-config.js` | Enables tracing; enforces mandatory in production |
| **LangGraph** | `services/coding-graph.js` | State machine (INTAKE → … → BILLING) |
| **Medical coding (traced)** | `services/medical-coding-service.js` | ChatGroq + tags for LangSmith |
| **Chat LLM (traced)** | `services/chat-llm-service.js` | ChatGroq for admin/voice commands |
| **Admin AI (traced)** | `services/admin-ai-assistant-service.js` | Uses ChatLLMService |
| **Semantic search (traced)** | `services/semantic-search-service.js` | OpenAIEmbeddings when available |

---

## Environment Variables

### LangSmith (required in production)

```bash
# API key (from https://smith.langchain.com)
LANGSMITH_API_KEY=lsv2_pt_...
# Or fallback
AP_Langchain=lsv2_pt_...

# Enable tracing (default: true when key present)
LANGCHAIN_TRACING_V2=true

# Optional: fail startup if missing in production
LANGSMITH_MANDATORY=true
```

### LangGraph

```bash
# Rollout percentage: 0=off, 0.1=10%, 1=100%
LANGGRAPH_ROLLOUT_PCT=1

# Shadow mode: run LangGraph alongside legacy path (no traffic routing)
LANGGRAPH_SHADOW=true

# Feature flag (DB/env): disable per-clinic
LANGGRAPH_ENABLED=true

# Postgres checkpointer (production)
POSTGRES_URL=postgresql://...
LANGGRAPH_USE_POSTGRES=true
LANGGRAPH_CHECKPOINT_SCHEMA=public
```

---

## Running Scripts

### Test LangSmith

```bash
cd middleware-platform
npm run test:langsmith
```

Verifies `LANGSMITH_API_KEY` and that a traced call reaches LangSmith. Requires network.

### Test LangGraph

```bash
npm run test:langgraph
```

Runs a transcript + function_call turn through the coding graph. Uses shadow mode by default.

### Reconcile LangGraph vs DB

Detects divergence between Postgres checkpoints and `voice_call_states`:

```bash
POSTGRES_URL=postgresql://... npm run reconcile:langgraph
# Repair mode (seeds up to 50 missing checkpoints)
POSTGRES_URL=... npm run reconcile:langgraph -- --repair
```

### Migrate to LangGraph

Seeds the Postgres checkpointer from existing `voice_call_states`:

```bash
POSTGRES_URL=... LANGGRAPH_USE_POSTGRES=true npm run migrate:langgraph
# Dry run
npm run migrate:langgraph -- --dry-run
# Limit rows
npm run migrate:langgraph -- --limit=100
```

---

## LangGraph State Flow

States: **INTAKE** → **EXTRACTION** → **TRIAGE** → **CODING** → **VALIDATION** → **BILLING**

- `processTurn(db, callId, triggerType, triggerPayload, options)` processes each turn.
- `triggerType`: `'transcript'` or `'function_call'`.
- Dual-writes to `voice_call_states` when rollout ≥ 100% or shadow mode.
- Checkpointer: **MemorySaver** (dev) or **PostgresSaver** (prod when `POSTGRES_URL` set).

---

## LangSmith Tags & Metadata

Medical coding traces include:

- **Tags**: `medical-coding`, `doctor-little`, `suggest_codes`, `clinic:{id}`, `call:{id}`
- **Metadata**: `clinic_id`, `call_id`, `operation`

Use these in LangSmith to filter and debug runs.

---

## Human Review (LangSmith)

LangSmith supports human review via **Evaluators** and **Feedback**:

### Evaluators
1. In LangSmith, open your project → **Evaluators** tab
2. Create evaluator (e.g. "Human Review"), add feedback questions (e.g. "Approve coding suggestion?")

### Feedback on Runs
1. Open a run in **Runs** tab → **Add feedback** on any step
2. Add scores or comments for review

### Dataset + Human Review Workflow
1. **Datasets** → Create dataset from successful runs
2. **Evaluators** → Create evaluator that flags runs for review
3. Runs with low scores routed to human review queue

### LangGraph Interrupt (Code-Level)
For human-in-the-loop *during* execution: `LANGGRAPH_HUMAN_REVIEW=true` (adds interrupt before BILLING stage).

---

## Feature Flags

`langgraph_enabled` controls LangGraph rollout:

- **Config**: `config/feature-flags.js` — `LANGGRAPH_ENABLED !== 'false'`
- **DB**: `feature_flags` table — `enabled_globally`, `enabled_for_clinic_ids`, `rollout_pct`
- **Utils**: `utils/feature-flags.js` — `isEnabled('langgraph_enabled', clinicId, callId)`

---

## Troubleshooting

| Issue | Action |
|-------|--------|
| No traces in LangSmith | Check `LANGSMITH_API_KEY`, `LANGCHAIN_TRACING_V2=true` |
| LangGraph returns null | Ensure `LANGGRAPH_ROLLOUT_PCT>0` or `LANGGRAPH_SHADOW=true` |
| PostgresSaver fails | Verify `POSTGRES_URL`; run `migrate:langgraph` after first deploy |
| Health shows degraded | Production requires LangSmith; set API key or accept degraded |

---

## Related Docs

- [LANGCHAIN_LANGGRAPH_RAG_ARCHITECTURE.md](../architecture/ai/LANGCHAIN_LANGGRAPH_RAG_ARCHITECTURE.md) — Full implementation architecture
- [MIDDLEWARE_BRAIN_IMPROVEMENTS_IMPLEMENTATION.md](../architecture/middleware/MIDDLEWARE_BRAIN_IMPROVEMENTS_IMPLEMENTATION.md) — Implementation details
