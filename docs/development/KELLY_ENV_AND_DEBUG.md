# Kelly (LLM) — environment and debugging

Primary implementation: `middleware-platform/services/llm-router.js`, `middleware-platform/services/kelly-agent-service.js`.

See also **`middleware-platform/.env.example`** for full variable names.

## Provider selection

| Variable | Purpose |
|----------|---------|
| `KELLY_PRIMARY_PROVIDER` | `anthropic` (default when `ANTHROPIC_API_KEY` is set) or `groq` for Groq-only. |
| `ANTHROPIC_API_KEY` | Claude (Anthropic). If unset, router falls back to Groq with a warning. |
| `GROQ_API_KEY` | Groq; used as primary or fallback depending on `KELLY_PRIMARY_PROVIDER`. |
| `KELLY_ANTHROPIC_MODEL` | Anthropic model id (default `claude-sonnet-4-5`). |
| `KELLY_GROQ_MODEL` / `KELLY_GROQ_FALLBACK_MODEL` | Groq models for primary and compact retry paths. |
| `KELLY_PROVIDER_TIMEOUT_MS` | Per-request HTTP timeout for LLM calls (default 20000). |
| `KELLY_TURN_TIMEOUT_MS` | Kelly turn-level timeout (documented in startup log). |
| `UNIFIED_CHANNEL_ADAPTER_ENABLED` | Feature flag for Phase 0 unified ingress adapter (`1`/`true` = use shared `adaptIncomingEvent` in chat + video ingress; default off keeps legacy paths). |
| `UNIFIED_CHANNEL_ADAPTER_SHADOW_ENABLED` | Shadow-mode adapter pass (`1`/`true` runs adapter side-by-side while legacy remains primary). |
| `CASE_DEIDENT_ENABLED` | Feature flag for de-identified case-pattern ingestion (`1`/`true` enables writing `case_patterns`; default off for dev/staging safety). |

## Streaming (commerce checkout SSE)

Streaming uses **`callStreamWithDeltas`** in `llm-router.js` so SSE paths respect the same primary provider as non-streaming `call()`.

## Debug logging (do not enable in production unless needed)

| Variable | Purpose |
|----------|---------|
| `KELLY_DEBUG=1` | Verbose traces in `kelly-agent-service.js` and `kelly-tool-executor.js` (per-tool, checkout, SLOTS, token recovery). |
| `KELLY_DEBUG_TURN=1` | Structured `[KellyDebug]` per-turn logs. |
| `KELLY_QUIET=1` | Skips the one-line Kelly startup config log. |
| `KELLY_LOG_STARTUP=1` | **Production:** re-enable the one-line Kelly startup log (off by default in `NODE_ENV=production`; dev/staging still logs unless `KELLY_QUIET=1`). |
| `KELLY_DEBUG_ANTHROPIC=1` | Logs truncated Anthropic request payload (router). |
| `DEBUG_LIVEKIT=1` | Verbose `POST /api/livekit/token` logs in `routes/livekit.js` (normally off in production; non-production is verbose by default). |
| `DEBUG_VIDEO_CONSULT_RAG=1` | Verbose `[video-consult][RAG]` query/merge logs in `services/video-consult-graph.js` (off in production unless set). |

## Production analytics

- RN checkout analytics: `patient-app/lib/checkoutAnalytics.ts` — optional sink `globalThis.__checkoutAnalyticsSink`.

## Future: structured logs

See **[STRUCTURED_LOGGING_FUTURE.md](./STRUCTURED_LOGGING_FUTURE.md)** (pino / correlation IDs — not implemented yet).
