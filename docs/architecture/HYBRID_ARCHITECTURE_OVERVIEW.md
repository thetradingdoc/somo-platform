# Hybrid Architecture — One-Page Overview

**Context:** Doctor Little uses multiple entry points (Voice, Video, PDF) that share coding, RAG, and FHIR. This doc answers “where does this run?” and “how are codes obtained?” in one place.

---

## Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  ENTRY POINTS                                                                           │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  VOICE (Retell)                    VIDEO (LiveKit)                 PDF                   │
│  ┌─────────────┐                   ┌─────────────────┐            ┌─────────────────┐   │
│  │ WebSocket   │                   │ Python agents   │            │ Coding          │   │
│  │ tool calls  │                   │ transcript /    │            │ orchestrator    │   │
│  │             │                   │ vision_frame /  │            │ (extract text)  │   │
│  │             │                   │ end_session     │            │                 │   │
│  └──────┬──────┘                   └────────┬────────┘            └────────┬────────┘   │
│         │                                  │                                │           │
└─────────┼──────────────────────────────────┼────────────────────────────────┼───────────┘
          │                                  │                                │
          ▼                                  ▼                                ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  MIDDLEWARE PLATFORM                                                                     │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  Voice:                          Video:                                                │
│  • tools → getCodeCandidates     • POST /api/video-consult/agent-events                 │
│    (local + optional Colab RAG)  • video-consult LangGraph:                             │
│  • optional coding-graph           accumulate → retrieve_context → human_review →       │
│    (LangGraph)                      store_fhir                                          │
│                                    • retrieve_context = getCodeCandidatesDualSource      │
│                                                                                         │
│  PDF: getCandidatesForCoding (Colab RAG + local fallback)                              │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
          │                                  │                                │
          └──────────────────┬───────────────┴────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  SHARED                                                                                  │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  • knowledge-service    getCodeCandidates, getCodeCandidatesDualSource, validateCodes   │
│  • remote-rag-client    Colab RAG (circuit breaker), returns { icd10, cpt, hcpcs }       │
│  • FHIR service         Encounter, Communication, audit                                 │
│  • LangSmith            Traces: video consult graph nodes, coding pipeline metadata     │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary Table

| Entry point   | How codes are obtained                                                                 | State / persistence                    | Traced (LangSmith)                          |
|--------------|-----------------------------------------------------------------------------------------|----------------------------------------|---------------------------------------------|
| **Voice**    | Tools call `knowledgeService.getCodeCandidates()`; optional coding-graph LangGraph     | Call state, coding_decisions           | If LangGraph used; tool calls in Retell      |
| **Video**    | `getCodeCandidatesDualSource()` in graph node (remote RAG + local, merge, validate)   | LangGraph checkpointer, session metadata, FHIR | Graph runs, retrieve_context metadata (remote_count, local_count, merged_count) |
| **PDF**      | `getCandidatesForCoding()` (Colab RAG + local fallback, guideline filter)               | Job/request scope                      | As configured for coding pipeline            |

---

## Key Boundaries

- **Single “get codes” path for video/assistant:** `knowledgeService.getCodeCandidatesDualSource(clinicalText, options)` — remote + local in parallel, merge, validate; boundary shape `{ code, description, confidence }`.
- **Circuit breaker:** Remote RAG wrapped in `utils/circuit-breaker.js` (e.g. `remote_rag`); when open, local-only.
- **Idempotency:** Duplicate `end_session` for the same room returns last result without re-running the pipeline.
- **Transcript:** On `end_session`, transcript is stored in session metadata (`audio_transcript`) so post-call UI and assistant see the same text used for RAG.

See **HYBRID_ARCHITECTURE_IMPROVEMENTS.md** for the improvement plan and **VIDEO_CONSULT.md** for video flow, env, and runbook.

---

**Last Updated:** April 6, 2026

---

## Translate before RAG (optional, §6)

**Current:** Coding and RAG (terminology, phrase matching) are English-oriented. Video consult sends the raw transcript to `getCodeCandidatesDualSource` with no language detection or translation.

**To support non-English consults:** Add an optional step before `retrieve_context`: if the transcript language is not English (e.g. from STT config or a small detector), call the perception layer’s `extractAndNormalizeText()` or a translate-only path and pass the normalized/translated text into `getCodeCandidatesDualSource`. Until then, document “English only for coding” (see **VIDEO_CONSULT.md** §3 STT/language).
