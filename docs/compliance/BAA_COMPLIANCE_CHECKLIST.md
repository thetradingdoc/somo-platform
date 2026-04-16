# BAA Compliance Checklist (Telemedicine Phase 1)

**Purpose:** Track Business Associate Agreement (BAA) status before PHI flows through new telemedicine endpoints.  
**Reference:** `todos/pending/TELEMEDICINE_TODOS.md` Phase 1 — Tasks 1–4.

| # | Task | Owner | Status | Notes |
|---|------|--------|--------|-------|
| 1 | **Sign Microsoft Azure BAA** | Legal / Ops | ⬜ Pending | Required before storing PHI in Blob Storage and Postgres in production. Azure Portal → Compliance → Business Associate Agreement. |
| 2 | **Sign Twilio BAA** | Legal / Ops | ⬜ Pending | Required before sending appointment-linked communications (SMS/voice). Twilio Console → Compliance. |
| 3 | **Sign / confirm OpenAI BAA** | Legal / Ops | ⬜ Pending | Required before sending transcript or lab content to GPT-4o. [OpenAI Enterprise / BAA](https://openai.com/enterprise). |
| 4 | **Confirm Pinecone HIPAA BAA** | Legal / Ops | ⬜ Pending | Check [pinecone.io/security](https://www.pinecone.io/security); if unavailable, evaluate compliant alternative for RAG vector store. |

**When complete:** Update status above (e.g. ✅ Done + date). Do not enable production PHI for telemedicine until all four are confirmed.
