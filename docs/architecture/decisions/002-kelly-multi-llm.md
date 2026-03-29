# ADR 002: Kelly uses a pluggable primary LLM (Anthropic vs Groq)

## Status

Accepted (`middleware-platform/services/llm-router.js`).

## Context

Kelly must run in production with reliable tool calling while keeping cost and latency manageable. Different environments may prefer Claude or Groq.

## Decision

- **`KELLY_PRIMARY_PROVIDER`** selects the primary provider when both keys may exist.
- **Non-streaming** and **streaming** commerce paths both use **`call` / `callStreamWithDeltas`** so harness and SSE behave consistently.
- **Transient failures** may fall back between providers per router rules.

## Consequences

- Reviewers should treat **env vars** (`ANTHROPIC_API_KEY`, `GROQ_API_KEY`, model names) as part of the Kelly contract.
- See **`docs/development/KELLY_ENV_AND_DEBUG.md`** for debug flags.
