# Structured logging (future)

Today **Kelly** and **LLMRouter** use `console.warn` / `console.error` and opt-in debug flags (`KELLY_DEBUG`, etc.).

## Direction

For production observability, consider:

- A single **structured logger** (e.g. **pino** with JSON lines) behind a thin wrapper.
- **Correlation IDs** per HTTP request and Kelly session, passed into tool execution.
- Redaction of **PII** and tokens at log boundaries.

No change is required for local development; this is a **future consolidation** when operational requirements justify the dependency and migration effort.
