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

## Streaming (commerce checkout SSE)

Streaming uses **`callStreamWithDeltas`** in `llm-router.js` so SSE paths respect the same primary provider as non-streaming `call()`.

## Debug logging (do not enable in production unless needed)

| Variable | Purpose |
|----------|---------|
| `KELLY_DEBUG=1` | Verbose traces (contact/slot/inject/tool payloads) in `kelly-agent-service.js`. |
| `KELLY_DEBUG_TURN=1` | Structured `[KellyDebug]` per-turn logs. |
| `KELLY_QUIET=1` | Skips the one-line Kelly startup config log. |
| `KELLY_DEBUG_ANTHROPIC=1` | Logs truncated Anthropic request payload (router). |

## Production analytics

- RN checkout analytics: `patient-app/lib/checkoutAnalytics.ts` — optional sink `globalThis.__checkoutAnalyticsSink`.

## Future: structured logs

See **[STRUCTURED_LOGGING_FUTURE.md](./STRUCTURED_LOGGING_FUTURE.md)** (pino / correlation IDs — not implemented yet).
