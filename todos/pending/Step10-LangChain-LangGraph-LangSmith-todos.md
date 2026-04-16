# Step 10 pipeline — LangChain guardrails, LangGraph orchestration, LangSmith tracing

**Purpose:** Backlog for moving the Step 10 (`process_patient` L1→L6) reasoning flow into production-grade agent infrastructure: **guardrails + retrieval**, **LangGraph** as the orchestration layer, **LangSmith** for observability, plus **product surfaces** (recommendations, optional provider match).

**Related:** `step10` (reference pipeline), `pending/Orchestration-todos.md`, `docs/middleware-platform/LANGGRAPH_LANGSMITH.md`, `middleware-platform/services/kelly-agent-service.js`, `middleware-platform/services/kelly-tool-executor.js`.

---

## Sequencing (read first)

**Do not start LangGraph Step 10 (§2 / s10-3) until the payment-rail / checkout session bugs are fixed and verified.** Layering LangGraph on a broken checkout state machine adds a second state layer that can fight `kelly_session_meta_kv` and makes loops harder to diagnose.

- **s10-1** (LangChain tools + guardrails) and **s10-2** (Kelly wiring + ProviderCard contract) may run **in parallel** with each other; they should not depend on checkout graph state.
- **s10-3** (LangGraph Step 10) starts **after** checkout rail stability (see **Payment rail — prerequisite fixes** below).
- **s10-4 / s10-5 / s10-6** follow as in the sections below.

### Payment rail — prerequisite fixes (before s10-3)

| Order | Item | Notes |
|-------|------|--------|
| 1 | **Bug 1** — Do not wipe shipping freshness when sending email code | Removing the line that cleared `commerce_shipping_updated_at_ms` on `send_commerce_verification_code` unblocks sessions where shipping was captured before or alongside email. |
| 2 | **Bug 2** — Deterministic handler: align **context version** with `_getCheckoutContextVersion` + **TTL** | Use the same version helper as `save_shipping_address`; refresh `commerce_shipping_updated_at_ms` when shipping is complete and version-aligned but TTL-only failed `prepare`. |
| 3 | **Bug 3** — Deterministic path calls **`save_shipping_address`** | Avoid duplicating shipping meta writes; single writer = same fingerprint / version / TTL rules as the LLM tool path. |
| 4 | E2E verify against the prior log pattern (rapid turns / prepare loop) | |
| 5 | Then start **s10-1**, **s10-2** (parallel) and **s10-3** | |

Implementation touchpoints: `kelly-tool-executor.js` (`send_commerce_verification_code`, `_isShippingReadyForCurrentContext`), `server.js` (`_maybeHandleDeterministicCommerceVerificationTurn`).

### Architecture notes (agreed)

- **Three-layer split** (LangChain tools → LangGraph orchestration → LangSmith) matches the existing hybrid model in `pending/Orchestration-todos.md`.
- **LangGraph checkpointer** should **replace** ad-hoc session meta as the source of truth for graph state, not duplicate it alongside `kelly_session_meta_kv` for the same transitions.
- **RAG JSON / `knowledge_export.json`:** Keep for deterministic code routing until maps live in DB or a dedicated service; Pinecone alone does not replace that.

---

## Design note (1): “Recommend doctor near you” — scope & UI (**hard requirements**)

### Reality in repo

There is **no** national verified directory wired for arbitrary “doctor near you” + phone. **`SpecialistResolverService`** (`middleware-platform/services/specialist-resolver-service.js`) is the existing resolver path used from Kelly tools — **ProviderCard data must come from that service or another explicit directory API**, not from model prose or open web scraping.

### Phone numbers — policy

- **Default UI:** **“Call clinic”** / **“Contact clinic”** (booking deep link or generic `tel:` only when `trust_tier === verified_directory` or equivalent on the payload).
- **Do not** surface a **direct phone number** in UI unless the value is **explicitly** from a **trusted source** (directory row ID, resolver record, signed API field).
- **Open web search** remains unsuitable as the **source of truth** for dialable numbers (stale listings, wrong numbers, harm in a medical context). Use web/PubMed-style tools for **evidence and citations**, not phone discovery.
- **s10-6:** **Legal/clinical sign-off is required before any phone number is shown in product UI** (add to release checklist).

### UI design (suggested)

1. **ProviderCard** props are **typed API-only** (`provider_id`, `display_name`, `specialty`, `distance_km`, `booking_url`, optional `phone` + **`phone_trust: 'verified_directory' | 'none'`**).  
2. If `phone_trust !== 'verified_directory'`, render **“Call clinic”** without displaying digits, or link only to official booking.  
3. Landing stays illustrative; live resolver only behind auth/portal where appropriate.

### Todos

- [ ] **1.1** Define **recommendation policy** (YAML or code): allowed categories (OTC, routine, urgent escalation), forbidden (definitive diagnosis, dosing without context).  
- [ ] **1.2** Implement **output validator** post-LLM (schema + blocklist); reject/regenerate on violation.  
- [ ] **1.3** **Tool: `search_medical_web`** (or PubMed/NCBI + allowlisted domains) with **citations**; no raw HTML dumps.  
- [ ] **1.4** **Tool / contract: provider match** — results **only** from **`SpecialistResolverService`** or an explicit directory API; schema includes `phone_trust`.  
- [ ] **1.5** Connect guardrail + tools to **Kelly** `kelly-tool-executor.js`; unit tests for tool-not-found and blocked paths.  
- [ ] **1.6** **ProviderCard** — implement contract above; **no** `tel:` from LLM-only strings (**hard requirement**).  
- [ ] **1.7** Rate limits + logging for web search; cost caps per session.

---

## 2) LangGraph — orchestrate Step 10

**Start only after payment-rail prerequisites above are green.**

High-level graph shape (align to `step10` layers):

- **Nodes (example):** `ingest` → `layer1_perception` → `layer2_cluster` → `layer3_…` → … → `layer6_audit_report` → `persist` / `handoff`.  
- **Checkpointer:** Postgres in prod; thread id = `patient_id` / `session_id`.  
- **Kelly:** Optional **bounded sub-node** for natural-language explanations between deterministic layer transitions (see `pending/Orchestration-todos.md`).  
- **Terminal states:** `complete`, `needs_human_review`, `failed_redacted`.

### Todos

- [ ] **2.1** Document Step 10 **state schema** (inputs/outputs per layer) as TypeScript/JSDoc or JSON Schema shared by graph + API.  
- [ ] **2.2** Map each Colab/`step10` function to a **single graph node** (or subgraph) with explicit inputs/outputs; no hidden globals.  
- [ ] **2.3** Implement **LangGraph** skeleton in `middleware-platform` (new module e.g. `services/step10-graph.js`) with `MemorySaver` dev / Postgres prod.  
- [ ] **2.4** Add **conditional edges** (e.g. skip L4 if low confidence; route to human review).  
- [ ] **2.5** Wire **emitToolEvent** / `path: langgraph_node` for each node transition (align with canonical pipeline in `pending/Orchestration-todos.md`).  
- [ ] **2.6** Feature flag: `STEP10_GRAPH_ENABLED`, shadow mode vs Kelly-only fallback.  
- [ ] **2.7** Integration test: single patient fixture → full graph → snapshot state + redacted logs.

---

## 3) LangSmith — trace

### Todos

- [ ] **3.1** Confirm env: `LANGSMITH_API_KEY`, `LANGCHAIN_TRACING_V2=true`, project name for Step 10 runs.  
- [ ] **3.2** Tag all Step 10 graph invokes: `step10`, `patient_id` hash, `layer`, `env`.  
- [ ] **3.3** Mirror **run_id / thread_id / parent_run_id** into LangSmith `metadata` and DB `tool_call_events` (per trace-correlation section in `pending/Orchestration-todos.md`).  
- [ ] **3.4** Redact PII/PHI in traced payloads via `redaction-service.js` before LangSmith export where applicable.  
- [ ] **3.5** Dashboard/runbook: how support finds a failed Step 10 run in LangSmith in &lt; 2 minutes.  
- [ ] **3.6** CI or nightly: `npm run test:langsmith` + optional smoke for Step 10 graph.

---

## 4) Product integration, APIs, and rollout

### Todos

- [ ] **4.1** **API:** Expose Step 10 graph behind authenticated route (e.g. `POST /api/patient/reasoning/step10/run`) with idempotency key.  
- [ ] **4.2** **Response contract** for UI: summary, layer highlights, `provider_cards[]` (optional), disclaimers.  
- [ ] **4.3** **Landing / Skin & Care:** Keep marketing copy **illustrative**; deep links to portal/chat where real graph runs.  
- [ ] **4.4** **Observability:** Metrics — latency per layer, graph failure rate, guardrail block rate.  
- [ ] **4.5** **Rollout:** staging → canary % → full; rollback = flag off + Kelly-only path.  
- [ ] **4.6** **Legal/clinical sign-off** — provider surfacing, **any displayed phone numbers**, web-cited clinical copy (gate before release).

- [x] **1.1** **Recommendation policy** — `middleware-platform/services/clinical-recommendation-policy.js` (expand categories later).  

- [x] **1.2** **Output validator** — non-commerce final reply in `KellyAgentService._runLLMLoop` uses policy `fallbackReply` on violation.  

- [x] **1.3** **Tool `search_medical_literature`** — PubMed E-utilities in `medical-literature-search-service.js`. Env: `NCBI_CONTACT_EMAIL`, `MEDICAL_LITERATURE_SEARCH_ENABLED`.  

- [x] **1.4** **Tool `find_clinic_specialists`** + **`provider-card-normalizer.js`** + resolver **`phone`** on map entries.  

- [x] **1.5** Kelly **`kelly-agent-service.js`** tool defs + **`kelly-tool-executor.js`** cases; Jest: `clinical-recommendation-policy`, `provider-card-normalizer`.  

- [ ] **1.6** **checkout-chat UI** — render structured `provider_cards` (no LLM-only `tel:`).  

- [ ] **1.7** Rate limits + logging for PubMed; cost caps per session.

## Open questions

- Single-tenant provider roster vs national search API?  
- Step 10 runs **sync** (blocking) vs **async job** + polling for long layers?  
- Should **checkout-chat** invoke Step 10, or only post-login patient flows?

