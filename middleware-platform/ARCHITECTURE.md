# Middleware platform architecture

**Last updated:** 2026-06-26

## Somo health (first-class)

Consumer agent lives in [`services/health/`](../services/health/). See [`docs/architecture/SOMO_HEALTH_AGENT.md`](../docs/architecture/SOMO_HEALTH_AGENT.md).

## Route registry

[`routes/index.js`](../routes/index.js) — `mountHealthSpine`, `mountAllRoutes`.

## Layering

```text
routes/ → services/health/ | kelly-rails/ | video-consult/ → database.js
```

## Related

- [MIDDLEWARE_PLATFORM.md](../docs/architecture/MIDDLEWARE_PLATFORM.md)
- [KELLY_ORCHESTRATION_ARCHITECTURE.md](../docs/architecture/KELLY_ORCHESTRATION_ARCHITECTURE.md)
