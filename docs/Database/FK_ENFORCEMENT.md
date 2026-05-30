# SQLite foreign key enforcement (H-08)

> **Last reviewed:** 2026-05-29

## Policy

- **Development:** Optional `PRAGMA foreign_keys=ON` after migrations complete.
- **Production:** Enable only after auditing legacy rows that violate FK constraints.

## Enable in dev

```bash
export SQLITE_FOREIGN_KEYS=1
cd middleware-platform && npm start
```

Startup logs: `SQLite foreign_keys=ON (SQLITE_FOREIGN_KEYS=1)`.

## Notes

- SQLite FK checks are off by default; numbered migrations in `middleware-platform/migrations/` must run first.
- Do not enable in production until a violation report is clean.

## Related

- [DB_STRUCTURE_AND_PIPELINE.md](./DB_STRUCTURE_AND_PIPELINE.md)
