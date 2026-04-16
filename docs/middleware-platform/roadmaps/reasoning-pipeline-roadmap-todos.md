# Reasoning pipeline — roadmap todos

Last-mile work from **ingredient-first (biochemical)** to **product-first (commercial/consumer)**, aligned with layered reasoning (structure → graph → NL + evidence).

Legend: `[ ]` not started · `[~]` in progress · `[x]` done (update as you ship)

---

## Epic A — Unified basket object & routine typing

- [ ] **A1 — Basket schema (v1)**  
  Define a versioned JSON schema: `Basket` = ordered steps (AM/PM or step index), each step = `{ product_ref?, ingredient_ids[], step_type, exposure }` where `step_type` ∈ `wash_off | leave_on | unknown` and `exposure` is optional (e.g. `rinse_immediate | overnight`).

- [ ] **A2 — Map `user_sessions.current_routine` → Basket**  
  Extend `session-state` / adapters so CRM-style `ProductRef[]` normalizes to canonical ingredient lists **and** step metadata when available (role from `product_ingredients.ingredient_role` or product-level tags).

- [ ] **A3 — Impact / priority weights**  
  Implement a small policy module: e.g. wash-off cleanser pairs down-weighted vs leave-on serum conflicts; document rules in code + unit tests.

- [ ] **A4 — `evaluateRoutine` / graph input from Basket**  
  Either flatten weighted pairs for v1 or add `evaluateBasket(basket)` that expands pairs with weights and merges duplicate edges (highest severity wins, or weighted score — pick one and document).

- [ ] **A5 — Kelly / tools**  
  Expose basket upsert + `evaluate_skincare_routine` (or successor) accepting basket shape; persist verdict + basket snapshot in session meta for snapshots.

- [ ] **A6 — Evals**  
  Add fixtures: same ingredients as cleanser vs serum step → different effective verdict or ordering notes; regression tests in `routine-reasoning-eval` or new file.

---

## Epic B — SKU-level evidence (RAG tier)

- [ ] **B1 — SKU metadata model**  
  Tables or JSON columns: per `product_id` — brand claims (short), `ph_min`/`ph_max` if known, usage warnings, “stabilized form” notes, links to monograph overrides.

- [ ] **B2 — Ingestion pipeline**  
  Job or admin path: OBF / manual / partner feed → populate SKU fields; validate against existing product graph.

- [ ] **B3 — `knowledge_chunks` (or sibling table) for SKU**  
  Stable chunk IDs keyed by `product_id` or `sku:` slug; `reason_codes` + optional `overrides_pair` for “this SKU + X is OK” exceptions (use sparingly, audited).

- [ ] **B4 — Retriever tier order**  
  Extend `retriever.js`: after pair-exact, optionally **SKU override chunk** → then ingredient monograph → reason-code → FTS. Cap total chunks unchanged or configurable.

- [ ] **B5 — Composer contract**  
  Ensure `RoutineReply` / prompts can cite SKU chunk IDs; `validateReply` unchanged or extended if SKU citations are required when product context exists.

- [ ] **B6 — Evals**  
  Golden cases: “Product X + niacinamide” where SKU text overrides generic vitC+niacin narrative.

---

## Epic C — Semantic retrieval (Pinecone or equivalent)

- [ ] **C1 — Decision record**  
  Choose: Pinecone vs pgvector vs hosted embedding API + existing DB; latency, cost, PII, and EU residency if relevant.

- [ ] **C2 — Chunk embedding spec**  
  For each `knowledge_chunks` row (and optional SKU chunks): embedding text = title + text + reason_codes string; stable `id` = chunk primary key.

- [ ] **C3 — Sync job**  
  Script: SQLite → export → upsert vectors; on migration or cron; handle deletes.

- [ ] **C4 — Hybrid query path**  
  `retriever.js`: semantic top-k ∪ existing deterministic tiers; dedupe by id; keep pair-exact **before** semantic broaden for safety.

- [ ] **C5 — Kelly / env**  
  `PINECONE_*` or provider keys; feature flag `SKINCARE_SEMANTIC_RAG=1`; fallback to FTS-only when off or unhealthy.

- [ ] **C6 — Evals**  
  Queries like “red angry skin” return chunks tagged soothing / barrier / centella without exact keyword in query string.

---

## Epic D — JSON-first agent / composer on every turn

- [ ] **D1 — Response envelope schema**  
  Define minimal `AgentTurnReply` v1: `{ version, mode: 'triage'|'routine'|'general', user_facing_text, structured?: RoutineReply|..., evidence_cited_ids[], safety_flags? }`.

- [ ] **D2 — Kelly post-process hook**  
  After `KellyAgentService.processTurn`, optional path: if skincare flow, map last tool verdict + chunks → composer LLM or `composeLocal` → `validateReply` / schema validate envelope → strip to `user_facing_text` for channel.

- [ ] **D3 — “Hello” and general chit-chat**  
  Sub-schema or fast path: short acknowledgement JSON still validated (no fake medical claims); no evidence ids required when `mode: 'general'` and no clinical assertion.

- [ ] **D4 — Logging & analytics**  
  Persist rejected LLM payloads + validation errors (sampled) for tuning.

- [ ] **D5 — Feature flag rollout**  
  `KELLY_JSON_FIRST_SKINCARE=1` per clinic or %; shadow mode: validate in parallel without swapping user-visible text until green.

- [ ] **D6 — Evals / Playwright**  
  Extend landing e2e or Kelly harness: assert response JSON shape on selected turns; adversarial “soften avoid” still rejected.

---

## Cross-cutting (do early)

- [ ] **X1 — Unify or deprecate dual corpora**  
  Document when to use `ingredient_rag_chunks` vs `knowledge_chunks`; migration or single `getChunksForVerdict` implementation.

- [ ] **X2 — Product resolution coverage**  
  Automate `% catalog with full INCI→ID resolution`; block or warn in basket evaluation when unresolved tokens remain.

- [ ] **X3 — Docs**  
  Update internal runbook: “Routine reasoning” = session → basket → graph → retrieve → compose → validate → UI snapshot.

---

## Suggested sequencing

1. **X1 + X2** (clarity + data quality)  
2. **A1–A4** (basket spine)  
3. **D1–D3 + D5** (safety envelope on high-risk flows first, not literally every greeting on day one)  
4. **B1–B4** (SKU tier)  
5. **C1–C4** (semantic layer)  
6. **A5–A6, B5–B6, C5–C6, D4, D6** (integration hardening)

---

## Quick answer: “Basket schema vs Pinecone first?”

- **Basket first** if your priority is **correct chemistry ordering and commercial routine realism** (cleanser vs serum).  
- **Pinecone first** if your priority is **discovery / fuzzy education queries** and you can keep graph+SQLite as source of truth for conflicts.

Recommended: **Basket (A1–A4)** before **Pinecone (C)** so semantic retrieval doesn’t outrun a typed routine model.
