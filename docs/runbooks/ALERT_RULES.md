# Alert Rules Configuration (Section 20)

Alert rules for Azure Monitor / Application Insights. Configure these in Azure Portal or via ARM/Bicep.

## Alert → Runbook Mapping

| Alert | Threshold | Runbook | Severity |
|-------|-----------|---------|----------|
| Stedi circuit open | >5 min | [STEDI_DOWN.md](./STEDI_DOWN.md) | P0 |
| Groq rate limit | 5 consecutive 429s | [GROQ_RATE_LIMIT.md](./GROQ_RATE_LIMIT.md) | P1 |
| Low confidence spike | >10% rejected | [LOW_CONFIDENCE_SPIKE.md](./LOW_CONFIDENCE_SPIKE.md) | P1 |
| Postgres sync queue depth | >100 pending | [POSTGRES_SYNC_BACKLOG.md](./POSTGRES_SYNC_BACKLOG.md) | P1 |
| Error rate spike | >5% | [ERROR_RATE_SPIKE.md](./ERROR_RATE_SPIKE.md) | P0 |
| Tool call DLQ backlog | >50 items | [ERROR_RATE_SPIKE.md](./ERROR_RATE_SPIKE.md) | P2 |

## Azure Monitor Rule Definitions

### 1. Error Rate > 5%

```
Metric: requests/failed
Aggregation: count
Condition: (failed / total) * 100 > 5
Window: 5 minutes
```

### 2. Stedi Circuit Breaker Open

```
Custom metric or log: circuit_breaker_state
Condition: value == 'OPEN' for service 'stedi'
Duration: 5 minutes
```

### 3. Groq 429 Consecutive

```
Log query: traces or customEvents where message contains "429" and message contains "Groq"
Condition: 5+ in 2 minutes
```

### 4. P95 Latency > 3s

```
Metric: dependencyDuration
Percentile: 95
Condition: > 3000 ms
Window: 5 minutes
```

## Channel Configuration

| Channel | Use For | Contacts |
|---------|---------|----------|
| Email | P1/P2 alerts | engineering@, ops@ |
| Slack | P1/P2 (non-page) | #alerts |
| PagerDuty | P0 | On-call rotation |

## Alert Metadata Template

Include in each alert:

```json
{
  "runbook": "https://github.com/.../docs/runbooks/ALERT_NAME.md",
  "severity": "P0",
  "tier": "middleware"
}
```

## Setup Steps

1. In Azure Portal: Monitor → Alerts → Create alert rule
2. Select scope: App Service / Function App for middleware
3. Condition: Add condition per table above
4. Actions: Create action group (email, Slack webhook, PagerDuty)
5. Details: Add runbook URL to description
