# Disaster Recovery

## Overview

Recovery procedures for Doctor Little middleware platform. Covers database restore, RTO/RPO targets, and escalation.

## RTO/RPO Targets

| Target | Value | Notes |
|--------|-------|-------|
| **RTO** (Recovery Time Objective) | 1 hour | Time to restore service after failure |
| **RPO** (Recovery Point Objective) | 5 min | Max acceptable data loss (point-in-time recovery when enabled) |
| **RPO** (backup-based) | 24 hours | When using daily backups only |
| **Backup frequency** | Daily (2 AM) | Automated via cron or GitHub Actions |

**Verification:** Test restore quarterly; document results in ops calendar.

## Backup Procedure

### Manual Backup

```bash
cd middleware-platform
npm run backup
# or
node scripts/backup-database.js
```

Creates: `backups/middleware-backup-YYYY-MM-DDTHH-MM-SS-sssZ.db`

### Automated Backup

- **Cron**: `0 2 * * * cd /path/to/middleware-platform && node scripts/backup-database.js --auto`
- **GitHub Actions**: See `docs/deployment/guides/BACKUP_STRATEGY.md`
- **Retention**: 30 days (with `--auto`)

### Cloud Storage (Production)

After backup, upload to cloud:

```bash
# Azure Blob
az storage blob upload --container-name backups --file backups/middleware-backup-*.db

# AWS S3
aws s3 cp backups/middleware-backup-*.db s3://your-bucket/backups/

# GCS
gsutil cp backups/middleware-backup-*.db gs://your-bucket/backups/
```

## Restore Procedure

### 1. Stop the Application

```bash
# PM2
pm2 stop middleware-platform

# Or stop the process serving the app
```

### 2. Backup Current State (if recoverable)

```bash
cp middleware.db middleware.db.pre-restore
```

### 3. Restore from Backup

```bash
cp backups/middleware-backup-YYYY-MM-DDTHH-MM-SS-sssZ.db middleware.db
```

Or from cloud:

```bash
az storage blob download --container-name backups --name middleware-backup-*.db --file middleware.db
```

### 4. Verify Database

```bash
node -e "
const db = require('better-sqlite3')('middleware.db');
console.log('Tables:', db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all().map(r=>r.name).join(', '));
console.log('Clinics:', db.prepare('SELECT COUNT(*) as n FROM clinics').get().n);
"
```

### 5. Restart Application

```bash
pm2 start middleware-platform
# or
npm start
```

### 6. Verify Health

```bash
curl http://localhost:4000/health?detailed=true
```

## Postgres (if used)

If using Postgres for sync/replication:

1. Restore Postgres from Azure/AWS backup per provider docs
2. Re-sync from SQLite if primary: run postgres sync worker after SQLite restore
3. Check `postgres_sync_retry` queue depth; see [POSTGRES_SYNC_BACKLOG.md](./POSTGRES_SYNC_BACKLOG.md)

## Quarterly Restore Test (Required)

**Recommended**: Test restore every quarter to verify backups are usable.

### Procedure

1. **Create backup:** `cd middleware-platform && node scripts/backup-database.js`
2. **Restore to temp DB:** `cp backups/middleware-backup-*.db test-restore.db`
3. **Smoke test (SQLite):** `node -e "const db=require('better-sqlite3')('test-restore.db'); console.log('Tables:', db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all().length); console.log('OK');"`
4. **Delete test file:** `rm test-restore.db`
5. **Document:** Record date and result in ops log

### Acceptance Criteria

- Backup file created successfully
- Restored DB loads; table count matches expected
- No corruption errors during read

## Escalation

| Severity | Contact | Action |
|----------|---------|--------|
| P0 — Full outage | On-call / DevOps | Restore from backup; notify team |
| P1 — Degraded | Engineering | Diagnose; apply runbook |
| P2 — Data inquiry | Support | Verify backup exists; schedule restore window |

## Related

- [BACKUP_STRATEGY.md](../deployment/guides/BACKUP_STRATEGY.md) — Backup setup and automation
- [POSTGRES_SYNC_BACKLOG.md](./POSTGRES_SYNC_BACKLOG.md) — Postgres sync retry queue
