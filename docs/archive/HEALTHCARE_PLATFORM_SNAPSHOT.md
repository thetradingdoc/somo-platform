# Healthcare platform snapshot

**Archived:** 2026-06-13  
**Branch:** `archive/healthcare-v3.1`  
**Tag:** `healthcare-v3.1.0`  
**Commit:** See `git rev-parse HEAD` on this branch.

## What was production (v3.1)

- **Kelly Rails V2** — voice + chat clinical front desk (lanes, tool allowlists, LangGraph checkpointer)
- **Retell AI** — inbound/outbound voice agent
- **Patient portal** — unified-dashboard HTML + patient-app Expo
- **RCM** — Stedi EDI eligibility/claims, Stripe/Circle payments
- **Medical coding** — ICD-10/CPT/HCPCS dual-source RAG (SQLite + Pinecone `doctorlittle`)
- **Agentic commerce** — checkout-chat, public checkout APIs
- **Provider portal** — business dashboard, voice setup, billing, RCM journey
- **Hosts:** callsomo.com (Firebase), api.callsomo.com (Cloud Run `somo-middleware`)

## Restore instructions

```bash
git fetch origin
git checkout archive/healthcare-v3.1
# or
git checkout healthcare-v3.1.0
```

Deploy from this branch/tag using the runbooks in `docs/deployment/OPERATIONS.md` on the snapshot.

## Repo split (2026-06-14)

`main` is the **healthcare front-desk platform** (this snapshot). The agentic **trading** experiment was moved to a separate repository:

- **Trading agent:** [richiejeremiah/trading-agent](https://github.com/richiejeremiah/trading-agent)
- **Pointer:** Trading agent — [richiejeremiah/trading-agent](https://github.com/richiejeremiah/trading-agent) (separate repo)

The `archive/healthcare-v3.1` branch and tag `healthcare-v3.1.0` remain historical labels for v3.1; `main` now tracks the same codebase after the split.
