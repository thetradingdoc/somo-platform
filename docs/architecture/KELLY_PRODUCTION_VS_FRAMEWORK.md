# Kelly Production vs Generic Framework Diagram

**Last updated:** 2026-06-18

Production voice is a **Node.js monolith on Cloud Run** — not the generic stack (FastAPI, Redis, Pinecone voice memory, OpenAI-only).

---

## What production has

- Twilio → Retell WSS → Kelly L2/L4 → `KellyToolExecutor` → SQLite (GCS) + Stripe/Twilio
- Gate-first booking, cancel, pay, safety
- `CONVERSATION_MODE_ROUTING=enforce` on `api.callsomo.com`
- Session projection + short chat history + triage rows

---

## Diagram vs reality

| Generic diagram | Production |
|-----------------|------------|
| FastAPI | **Express** on Cloud Run |
| Redis sessions | SQLite projection; Redis **not** voice SSOT |
| Pinecone voice KB | Pinecone for **medical coding** fallback only |
| OpenAI | **Anthropic + Groq** (`llm-router.js`) |
| Message queue | In-process `notification-queue.js` |
| Tool sandbox | **None** — direct DB/HTTP |
| K8s / Terraform | Cloud Run + gcloud deploy scripts |

---

## Prioritized production gaps

### P0 operational

| Gap | Risk |
|-----|------|
| SQLite on GCS | Contention under load |
| L2 + L4 dual planning | Real-call loops vs sandbox |
| Env drift after deploy | Run `verify:kelly-rails-cloudrun` |

### P1 orchestration

| Gap | Risk |
|-----|------|
| Turn planner booking-only | Cancel/reschedule imperative chains |
| No outcome-driven `advanceAfterStep` | Step bugs recur |
| Tenant `policy_json` | Wrong triage-before-book |

### P2 platform (deferred — not voice Kelly)

- Long-context summarization (>20 turns)
- Redis / Postgres voice SSOT migration
- Distributed notification queue
- External clinic FAQ vector KB
- Unified chat + voice client
- LangGraph shell removal (low ROI)

---

## Medical coding (separate path)

`suggest_codes` uses `getCodeCandidatesDualSource`: local SQLite codebooks + optional Pinecone metadata. Not on the voice orchestration path.

Prod checklist: `npm run verify:prod-codebook`, `PINECONE_INDEX_HOST` configured.

---

## Rollback

Env-first: `CONVERSATION_MODE_ROUTING=shadow` on Cloud Run. Code rollback second: revert + `npm run callsomo:deploy-api`.
