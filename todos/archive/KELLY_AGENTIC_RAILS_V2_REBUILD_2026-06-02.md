# Kelly Agentic Rails V2 Rebuild — Completed (code landing)

**Date:** 2026-06-02

## Summary

Replaced bridge-on-legacy with [`middleware-platform/services/kelly-rails/`](../../middleware-platform/services/kelly-rails/): LangGraph main graph, per-lane steps, tool allow-lists, bounded `node-runner`, and `kelly-turn-resolver` entry.

## Key files

| Module | Role |
|--------|------|
| `kelly-rails/orchestrator.js` | `handleTurn` — no `processTurn` on v2 path |
| `kelly-rails/main-graph.js` | LangGraph checkpointer host |
| `kelly-rails/execute-turn.js` | Route + lane step execution |
| `kelly-rails/lanes.js` | Step chains, payment guardrail, case summary on schedule |
| `kelly-turn-resolver.js` | `KELLY_RAILS_V2` switch |

## Wired entrypoints

- `kelly-triage-turn-service.js`
- `retell-websocket.js`
- `patient-checkout-chat-service.js`
- `funnel-intake-orchestrator.js`
- `e2e-kelly-rcm-pay-conversation.cjs` (defaults `KELLY_RAILS_V2=1`)

## Docs

- [`docs/architecture/kelly_rails_v2_as_built.md`](../../docs/architecture/kelly_rails_v2_as_built.md)

## Follow-up

- Run F2 locally with LLM keys (E7-1)
- V6-3 provider-shell staging
- Remove legacy `processTurn` default after production validation
