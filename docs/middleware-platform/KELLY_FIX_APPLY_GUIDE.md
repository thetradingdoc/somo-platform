# Kelly fix bundle — apply guide

This doc summarizes changes aligned with the **Kelly fix bundle** (LLM routing, triage RAG, migrations, harness hygiene).

## Environment variables

| Variable | Purpose |
|----------|---------|
| `KELLY_PROVIDER_TIMEOUT_MS` | Per-provider HTTP timeout in `llm-router.js` (default `20000`). |
| `KELLY_GROQ_FALLBACK_TO_ANTHROPIC` | Set to `0` to disable **Groq → Anthropic** cross-fallback when both API keys exist. Default: enabled (non-`0`). |
| `KELLY_RATE_LIMIT_REPLY_CHAT` / `KELLY_RATE_LIMIT_REPLY_VOICE` | Optional user-facing copy when Kelly degrades on 429 / rate limits. |
| `KELLY_PRIMARY_PROVIDER` | `anthropic` or `groq` (see `llm-router.js`). |

See `middleware-platform/.env.example`.

## Code touchpoints

1. **`services/llm-router.js`** — `withTimeout`, ordered primary/secondary calls, optional `forceProvider` (no cross-fallback), transient-error cross-fallback (excludes 401/403).
2. **`services/kelly-agent-service.js`** — Main LLM loop and closing message use **`LLMRouter.call`** (not direct `groq.chat.completions.create`) so Groq-primary turns get timeouts + Claude fallback when configured.
3. **`services/kelly-tool-executor.js`** — `run_triage_rag` completion uses **`_confidenceFromTriageRow`** for `rag_confidence` (not a static threshold fallback).
4. **`services/triage-rag-service-v2.js`** — Tracks **`knowledgeFetchSucceeded`**: if every knowledge call throws, V2 **does not** pass an empty `_ragResultOverride`; V1 runs `getCodeCandidates` once. On success (including empty codes), passes override to avoid duplicate fetches.
5. **`migrations/017_triage_rag_confidence_backfill.js`** — Idempotent columns + `rag_confidence` NULL → `0.0` backfill.
6. **`middleware/health-check.js`** — With `?show_db_path=1`, response includes **`database_path`** and alias **`db_path`** for harness/tools.

## Verify

```bash
cd middleware-platform
npm run migrate   # applies 017 if needed
npm run test:kelly
```

Harness DB file must match the running server (`GET /health?show_db_path=1` → `database_path` / `db_path`).
