# Backup drill record

Record each GCS SQLite backup/restore drill for production.

| Date | Operator | Bucket prefix | Latest object | Scratch restore | Notes |
|------|----------|---------------|---------------|-----------------|-------|
| _(pending first drill)_ | | `gs://$GCS_DB_BUCKET/backups/` | | | Run `npm run verify:backup-drill` |

## Procedure

1. `cd middleware-platform && npm run verify:backup-drill`
2. Confirm `backups/` prefix lists recent `middleware-*.db` objects
3. Update the table above with date, operator, and object name
4. Review `docs/runbooks/SECRETS_ROTATION.md` on the same cadence
