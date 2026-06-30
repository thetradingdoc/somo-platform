# Middleware Platform Architecture

**Last updated:** 2026-06-26

Node/Express monolith at `middleware-platform/`. Routes → services → `database.js`.

## Domain packages

| Domain | Location | Status |
|--------|----------|--------|
| **Somo health** | `services/health/` | **KEEP** — first-class |
| Kelly rails | `services/kelly-rails/`, `conversation-mode/` | FREEZE |
| Provider video | `services/video-consult/` (barrel) | KEEP |
| Voice PSTN | `services/voice/` (barrel) | FREEZE |
| RCM | `services/rcm/` (barrel) | KEEP |
| Payments | `services/payments/` (barrel) | KEEP |
| Commerce | gated `COMMERCE_LEGACY_ENABLED` | DELETE |

## Route registry

[`routes/index.js`](../middleware-platform/routes/index.js): `mountHealthSpine`, `mountAllRoutes` (incremental).

Health mounts:
- `/api/health-session` — session API + transport (SSE, agent-events)

## Agent stacks

1. **Somo health** — Groq tool loop (`health/agent/orchestrator`)
2. **Kelly voice** — L2 conversation-mode + L4 kelly-rails
3. **Provider HUD** — `video-consult-graph` LangGraph

## Data

- SQLite primary; migrations in `migrations/`
- New SQL → `database/repos/`
- Session SSOT: [SESSION_SSOT_MATRIX.md](./SESSION_SSOT_MATRIX.md)

## Quality gates

```bash
npm run check:health-imports
npm run test:health
npm run health:acceptance -- --offline
```

## Scale

- SSE: `HEALTH_SSE_BUS=memory` (default); Redis stub at `health/transport/sse-redis-adapter.js`
- Runbook: [HEALTH_MULTI_REPLICA.md](../runbooks/HEALTH_MULTI_REPLICA.md)

## Related

- [SOMO_HEALTH_AGENT.md](./SOMO_HEALTH_AGENT.md)
- [ROUTE_OWNERSHIP.md](./ROUTE_OWNERSHIP.md)
- [KELLY_ORCHESTRATION_ARCHITECTURE.md](./KELLY_ORCHESTRATION_ARCHITECTURE.md)
