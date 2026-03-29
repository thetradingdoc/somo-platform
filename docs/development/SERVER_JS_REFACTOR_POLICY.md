# `server.js` — incremental refactor policy

`middleware-platform/server.js` is the Express entry and still contains a large amount of route wiring and handlers.

## Rules for new work

1. **Prefer new HTTP handlers in `middleware-platform/routes/*.js`** and mount with `app.use('/api/...', router)` (or equivalent) from `server.js`.
2. **Business logic** belongs in `services/` (and `adapters/` for third parties), not inline in `server.js`.
3. **Touching `server.js` for a small change** is acceptable when moving code out would balloon the PR; follow up with extraction when practical.

## Review expectation

PRs that **add hundreds of lines** to `server.js` should either split into a route module or include a short note explaining why not (hotfix, etc.).

## Long-term

Reduce file size over time by moving **one route group at a time** to `routes/`, keeping behavior identical and tests/CI green.
