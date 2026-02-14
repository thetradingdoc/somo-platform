# Data Retention Policy

## Overview

Retention periods for Doctor Little middleware platform data. Aligns with billing compliance (7 years for coding/claims) and operational needs.

## Retention by Data Type

| Table / Data | Retention | Rationale |
|--------------|-----------|-----------|
| `voice_call_log` | 1 year | Call history, troubleshooting |
| `coding_decisions` | 7 years | Billing compliance (CMS, payer audits) |
| `llm_usage_log` | 90 days | Cost analysis, performance tuning |
| `function_call_log` | 90 days | Debugging, audit trail |
| `voice_conversation_memory` | 30 days | Configurable in app |
| `idempotency_keys` | 24 hours | TTL; daily cleanup |
| `postgres_sync_retry` | 7 days | Retry queue |
| `postgres_sync_dlq` | 90 days | Manual review before purge |
| `hipaa_access_log` | 7 years | HIPAA audit requirement; delete after retention |

## Cleanup

Run periodically (e.g. daily cron):

```bash
cd middleware-platform
node scripts/cleanup-retention.js
```

Or with `--dry-run` to preview:

```bash
node scripts/cleanup-retention.js --dry-run
```

## Legal Hold

If a legal hold applies, pause cleanup for affected tables. Document hold in `docs/compliance/legal-holds/`.
