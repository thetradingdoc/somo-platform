# ADR 001: SQLite as default application database

## Status

Accepted (as implemented in `middleware-platform/database.js`).

## Context

The middleware needs embedded persistence for sessions, commerce, appointments, and related tables without mandatory external infrastructure for small deployments.

## Decision

Use **SQLite** (`better-sqlite3`) as the default store with migrations run at startup.

## Consequences

- **Pros:** Simple local and small-cloud deploys; few moving parts; fast iteration.
- **Cons:** Horizontal scaling and HA require a different store or replication strategy later; document migration paths (e.g. Postgres) when load or compliance demands it.
