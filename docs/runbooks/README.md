# Incident Runbooks

Runbooks for Doctor Little middleware platform incidents. Use with Application Insights or Azure Monitor alerts.

## Alert → Runbook Mapping

| Alert | Threshold | Runbook |
|-------|-----------|---------|
| Stedi circuit open | >5 min | [STEDI_DOWN.md](./STEDI_DOWN.md) |
| Groq rate limit | 5 consecutive 429s | [GROQ_RATE_LIMIT.md](./GROQ_RATE_LIMIT.md) |
| Low confidence spike | >10% rejected | [LOW_CONFIDENCE_SPIKE.md](./LOW_CONFIDENCE_SPIKE.md) |
| Postgres sync backlog | >100 pending | [POSTGRES_SYNC_BACKLOG.md](./POSTGRES_SYNC_BACKLOG.md) |
| Error rate spike | >5% | [ERROR_RATE_SPIKE.md](./ERROR_RATE_SPIKE.md) |

## Disaster Recovery

- [DR.md](./DR.md) — Backup, restore, RTO/RPO
