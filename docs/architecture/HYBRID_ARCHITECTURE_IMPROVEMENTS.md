# Hybrid Architecture — Improvements (Implemented)

**Last Updated:** February 2026

This doc listed planned improvements for the hybrid Voice + Video + PDF + RAG setup. **All items below are implemented.** For current architecture and boundaries, see **[HYBRID_ARCHITECTURE_OVERVIEW.md](./HYBRID_ARCHITECTURE_OVERVIEW.md)**.

---

## Implemented

| # | Item | Status |
|---|------|--------|
| 1 | **Unify get-code pipeline** | `knowledgeService.getCodeCandidatesDualSource()` — remote RAG + local in parallel, merge, validate. Used by video graph and assistant. |
| 2 | **Circuit breaker for remote RAG** | `remote-rag-client.js` uses `utils/circuit-breaker.js` (name `remote_rag`). Env: `RAG_CIRCUIT_FAILURE_THRESHOLD`, `RAG_CIRCUIT_WINDOW_MS`, `RAG_CIRCUIT_RESET_MS`. |
| 3 | **Observability (coding pipeline)** | `retrieve_context` node returns `processing_metadata`: `remote_count`, `local_count`, `merged_count`; telemetry adds node duration. Visible in LangSmith. |
| 4 | **Persist transcript on end_session** | Graph returns `audio_transcript`; route passes it in `endSession(room, { ...result })`; `getSessionState` uses `meta.audio_transcript`. |
| 5 | **Single code shape at boundary** | All code arrays use `{ code, description, confidence }`; validation in shared pipeline; `invalid_codes` when applicable. |
| 6 | **Translate before RAG (optional)** | Documented in HYBRID_ARCHITECTURE_OVERVIEW.md §6; code comment in video-consult-graph at RAG call. English-only coding until translate step added. |
| 7 | **Idempotency for end_session** | Route checks `session?.session_status === 'ended'`; if so, returns success + last result from metadata without re-running graph. |
| 8 | **One-page hybrid diagram** | [HYBRID_ARCHITECTURE_OVERVIEW.md](./HYBRID_ARCHITECTURE_OVERVIEW.md) — diagram, summary table, boundaries. |

---

## Reference (original plan)

The original improvement plan is preserved in git history. Priority order was: §1 → §4 → §2 → §5 → §3 → §8 → §7 → §6.
