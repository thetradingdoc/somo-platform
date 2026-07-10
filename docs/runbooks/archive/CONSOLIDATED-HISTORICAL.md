# runbooks — consolidated documentation

**Single file:** All former `docs/runbooks/**/*.md` content is merged here. **Last updated:** 2026-05-25

## Somo voice and tenant runbooks (standalone)

| Runbook | Purpose |
|---------|---------|
| [voice-inbound-troubleshooting.md](./voice-inbound-troubleshooting.md) | Twilio → `/voice/incoming` → Retell WS → DB |
| [prod-preflight-census.md](./prod-preflight-census.md) | Read-only prod tenant census before dev writes |
| [wipe-tenant-data.md](./wipe-tenant-data.md) | Stripe → Twilio → Retell → DB wipe order |

Database Week 1 steps: [SOMO_FOUNDATION_RUNBOOK.md](../Database/SOMO_FOUNDATION_RUNBOOK.md).

---

## Table of contents

- [Alert Rules Configuration (Section 20) (`ALERT_RULES.md`)](#alert-rules)
- [DLQ Tool Calls Incident Note (`DLQ_TOOL_CALLS_INCIDENT_NOTE.md`)](#dlq-tool-calls-incident-note)
- [Archived terminal DLQ snapshots (`../archive/runbooks-incidents/`)](#dlq-tool-calls-incident-note)
- [Disaster Recovery (`DR.md`)](#dr)
- [Error Rate Spike (>5%) (`ERROR_RATE_SPIKE.md`)](#error-rate-spike)
- [Groq Rate Limit (429) (`GROQ_RATE_LIMIT.md`)](#groq-rate-limit)
- [Low Confidence Spike (>10% Rejected) (`LOW_CONFIDENCE_SPIKE.md`)](#low-confidence-spike)
- [Runbook — Payment processor outage (Stripe/Circle) (`middleware-platform/RUNBOOK_PROCESSOR_OUTAGE.md`)](#middleware-platform-runbook-processor-outage)
- [Runbook — Reconciliation drift / SLA breaches (`middleware-platform/RUNBOOK_RECONCILIATION_DRIFT.md`)](#middleware-platform-runbook-reconciliation-drift)
- [Runbook — Replay attack attempt (webhooks / payment routes) (`middleware-platform/RUNBOOK_REPLAY_ATTACK_ATTEMPT.md`)](#middleware-platform-runbook-replay-attack-attempt)
- [Runbook — Stripe webhook failures (`middleware-platform/RUNBOOK_STRIPE_WEBHOOK_FAILURES.md`)](#middleware-platform-runbook-stripe-webhook-failures)
- [Postgres Sync Backlog (>100 Pending) (`POSTGRES_SYNC_BACKLOG.md`)](#postgres-sync-backlog)
- [Incident Runbooks (`README.md`)](#readme)
- [Reasoning Canary Rehearsal Note (`REASONING_CANARY_REHEARSAL_NOTE.md`)](#reasoning-canary-rehearsal-note)
- [Reasoning gate failure triage (`REASONING_GATE_FAILURE_TRIAGE.md`)](#reasoning-gate-failure-triage)
- [Reasoning kill-switch recovery (`disable → stabilize → re-enable`) (`REASONING_KILL_SWITCH_RECOVERY.md`)](#reasoning-kill-switch-recovery)
- [Post-incident template — reasoning (gate-level root cause) (`REASONING_POST_INCIDENT_TEMPLATE.md`)](#reasoning-post-incident-template)
- [Reasoning Rollout Runbook (`REACT_APP_RESULTS_SUMMARY_V1`) (`REASONING_ROLLOUT_RUNBOOK.md`)](#reasoning-rollout-runbook)
- [STAGING_SMOKE_TEST (`STAGING_SMOKE_TEST.md`)](#staging-smoke-test)
- [Stedi API Down (`STEDI_DOWN.md`)](#stedi-down)
---

## Introduction

Browse by anchor above. Each section notes the former file path.

---

<a id="alert-rules"></a>

## Alert Rules Configuration (Section 20)

*Former path: `docs/runbooks/ALERT_RULES.md`*

Alert rules for Azure Monitor / Application Insights. Configure these in Azure Portal or via ARM/Bicep.

## Alert → Runbook Mapping

| Alert | Threshold | Runbook | Severity |
|-------|-----------|---------|----------|
| Stedi circuit open | >5 min | [STEDI_DOWN.md](./README.md#stedi-down) | P0 |
| Groq rate limit | 5 consecutive 429s | [GROQ_RATE_LIMIT.md](./README.md#groq-rate-limit) | P1 |
| Low confidence spike | >10% rejected | [LOW_CONFIDENCE_SPIKE.md](./README.md#low-confidence-spike) | P1 |
| Postgres sync queue depth | >100 pending | [POSTGRES_SYNC_BACKLOG.md](./README.md#postgres-sync-backlog) | P1 |
| Error rate spike | >5% | [ERROR_RATE_SPIKE.md](./README.md#error-rate-spike) | P0 |
| Tool call DLQ backlog | >50 items | [ERROR_RATE_SPIKE.md](./README.md#error-rate-spike) | P2 |
| Food route cosmetic harmful copy regression | >0 in 10 min | [LOW_CONFIDENCE_SPIKE.md](./README.md#low-confidence-spike) | P1 |
| Food route key_actives available regression | >0 in 10 min | [LOW_CONFIDENCE_SPIKE.md](./README.md#low-confidence-spike) | P1 |
| Non-cosmetic NYC context leakage | >0 in 10 min | [LOW_CONFIDENCE_SPIKE.md](./README.md#low-confidence-spike) | P1 |
| Reasoning API error rate | >2% in 10 min | [REASONING_KILL_SWITCH_RECOVERY.md](./README.md#reasoning-kill-switch-recovery) | P1 |
| Reasoning provider error gate | >1% of attempts in 10 min | [REASONING_GATE_FAILURE_TRIAGE.md](./README.md#reasoning-gate-failure-triage) | P1 |
| Reasoning fallback spike | >20% in 10 min | [Reasoning docs — rollout gate](../reasoning/README.md#rollout-gate-shadow-canary-ci-rollback) | P1 |
| Reasoning latency spike | p95 > 8s in 10 min | [REASONING_KILL_SWITCH_RECOVERY.md](./README.md#reasoning-kill-switch-recovery) | P1 |
| Reasoning estimated cost spike | >2x 24h baseline | [Reasoning docs — rollout gate](../reasoning/README.md#rollout-gate-shadow-canary-ci-rollback) | P2 |
| Reasoning schema gate failures | sustained elevation vs baseline | [REASONING_GATE_FAILURE_TRIAGE.md](./README.md#reasoning-gate-failure-triage) | P1 |
| Reasoning semantic contract gate failures | sustained elevation vs baseline | [REASONING_GATE_FAILURE_TRIAGE.md](./README.md#reasoning-gate-failure-triage) | P1 |
| Reasoning confidence deferrals | sustained elevation vs baseline | [REASONING_GATE_FAILURE_TRIAGE.md](./README.md#reasoning-gate-failure-triage) | P2 |
| Reasoning safety gate failures | any sustained > 0 | [REASONING_GATE_FAILURE_TRIAGE.md](./README.md#reasoning-gate-failure-triage) | P0 |
| Reasoning merge stale/conflict rejects | spike with falling merge success | [REASONING_GATE_FAILURE_TRIAGE.md](./README.md#reasoning-gate-failure-triage) | P2 |
| Reasoning merge stale reject rate | `stale_reject / merge_success` > 0.25 for 15 min OR `stale_reject` > 25/min | [REASONING_GATE_FAILURE_TRIAGE.md](./README.md#reasoning-gate-failure-triage) | P2 |
| Reasoning stale patch (FSM) rejects | `reasoning.fsm.transition.rejected_stale_patch.count` > 10 in 15 min OR > 3× trailing 7d median | [REASONING_GATE_FAILURE_TRIAGE.md](./README.md#reasoning-gate-failure-triage) | P2 |

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

### 5. Category Route Regression Guards

```
Metric: result_summary.regression.non_cosmetic.cosmetic_harmful_copy.count
Condition: > 0
Window: 10 minutes
```

```
Metric: result_summary.regression.non_cosmetic.key_actives_available.count
Condition: > 0
Window: 10 minutes
```

```
Metric: session_result_snapshot.regression.non_cosmetic.nyc_context_present.count
Condition: > 0
Window: 10 minutes
```

### 6. Reasoning API Error Rate

```
Metrics:
- reasoning.api_error.count
- reasoning.provider.call.count
Condition: api_error / provider_call_count > 0.02
Window: 10 minutes
```

### 7. Reasoning Fallback Ratio Spike

```
Metrics:
- reasoning.mode.fallback.count
- result_summary.reasoning.generated.count
Condition: fallback / generated > 0.20
Window: 10 minutes
```

### 8. Reasoning Latency p95 Spike

```
Metric: reasoning.provider.latency_ms.total + reasoning.provider.latency_ms.count
Derived: p95 from APM trace/dependency telemetry
Condition: p95 > 8000 ms
Window: 10 minutes
```

### 9. Reasoning Estimated Cost Spike

```
Metric: reasoning.cost.estimated_microusd.total
Condition: > 2x rolling 24h baseline
Window: 30 minutes
```

### 10. Reasoning Gate Failures (schema / semantic / confidence / safety)

```
Metrics (examples):
- reasoning.gate.schema.fail.count
- reasoning.gate.semantic_contract.fail.count
- reasoning.gate.confidence.defer.count
- reasoning.gate.safety.fail.count
- reasoning.gate.provider_error.count
Condition: sustained elevation vs trailing baseline per gate (see [Reasoning docs — rollout gate](../reasoning/README.md#rollout-gate-shadow-canary-ci-rollback), canary thresholds table)
Window: 10–30 minutes
```

### 11. Reasoning Merge Lineage Rejects

```
Metrics:
- reasoning.merge.stale_reject.count
- reasoning.merge.conflict_reject.count
- reasoning.merge.merge_success.count
Derived (alert): stale_reject_rate = stale_reject / max(merge_success, 1) over 15m window
Correlate with user edit churn, double-baseline builds, and `reasoning.fsm.transition.rejected_stale_patch.count` before paging.
```

### 12. Reasoning stale patch rejects (FSM)

```
Metric: reasoning.fsm.transition.rejected_stale_patch.count
Aggregation: sum
Condition: sum > 10 in 15 minutes OR sum > 3x rolling 7d median (same hour-of-day)
Window: 15 minutes
Runbook: REASONING_GATE_FAILURE_TRIAGE.md (merge / async job freshness)
Correlate with reasoning.merge.merge_success.count (drops imply user-visible merge starvation).
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


---

<a id="dlq-tool-calls-incident-note"></a>

## DLQ Tool Calls Incident Note

*Former path: `docs/runbooks/DLQ_TOOL_CALLS_INCIDENT_NOTE.md`*

Generated: 2026-04-19T01:01:10.482Z

## Backlog
- Before replay: 0
- After replay: 0
- Stable check (1s): 0
- Threshold (50): below

## Breakdown (error_type:function_name)

## Retry Replay
- Retry-safe entries: 0
- Replay attempts: 0
- Replay success: 0
- Replay success rate: 1

## Classification Rules
- timeout: timeout/timed out/etimedout
- dependency: upstream/network/rate-limit/5xx/dns/connection
- auth: unauthorized/forbidden/401/403
- validation: schema/validation/invalid/parse

## Current Investigation Pass (End-to-End)

- Counts by tool: none (DLQ total is 0)
- Counts by error_type:function_name: none (DLQ total is 0)
- Classification split:
  - retry-safe: 0
  - terminal: 0
  - other: 0

## Exact Replay Actions

Executed in this pass:

1. `node ./middleware-platform/scripts/dlq-tool-calls-triage-and-replay.cjs`
   - Result: `before_size=0`, `replay_attempts=0`, `after_size=0`
2. Deep classification query (tool/error + retry-safe/terminal split) via Node runtime against `dlq_tool_calls`
   - Result: `total=0`, no actionable entries

If backlog returns in future runs, execute in order:

1. Retry-safe replay:
   - `node ./middleware-platform/scripts/dlq-tool-calls-triage-and-replay.cjs`
2. Terminal cleanup (unknown/not-implemented tools):
   - `node ./middleware-platform/scripts/dlq-tool-calls-resolve-terminal.cjs`
3. Post-action validation:
   - rerun `node ./middleware-platform/scripts/dlq-tool-calls-triage-and-replay.cjs`
   - confirm `after_size < 50` and stable check remains below threshold



---

<a id="dr"></a>

## Disaster Recovery

*Former path: `docs/runbooks/DR.md`*


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
- **GitHub Actions**: See `docs/deployment/README.md#guides-backup-strategy`
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
3. Check `postgres_sync_retry` queue depth; see [POSTGRES_SYNC_BACKLOG.md](./README.md#postgres-sync-backlog)

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

- [BACKUP_STRATEGY.md](../deployment/README.md#guides-backup-strategy) — Backup setup and automation
- [POSTGRES_SYNC_BACKLOG.md](./README.md#postgres-sync-backlog) — Postgres sync retry queue


---

<a id="error-rate-spike"></a>

## Error Rate Spike (>5%)

*Former path: `docs/runbooks/ERROR_RATE_SPIKE.md`*


## Symptoms

- Application Insights shows error rate >5% over last 15–60 minutes
- Increase in 5xx responses or unhandled exceptions
- User reports of failures (voice calls, API, checkout)
- Health check may show `status: degraded` or `unhealthy`

## Impact

- **User experience** — Failed requests; voice calls may drop or return errors
- **Revenue** — Payment or claim failures
- **Trust** — Repeated failures affect clinic and patient trust

## Diagnosis

1. **Application Insights** — Error rate, failure trend, top error types
2. **Check health**: `GET /health?detailed=true` — DB, memory, dependencies
3. **Check circuit breakers** — `GET /api/admin/metrics` — `circuit_breaker_states`
4. **Correlation IDs** — Use `x-request-id` to trace failing requests
5. **Recent deploys** — Correlation with deployment time

## Mitigation

1. **Identify root cause** — Stedi? Groq? DB? See specific runbooks:
   - [STEDI_DOWN.md](./README.md#stedi-down)
   - [GROQ_RATE_LIMIT.md](./README.md#groq-rate-limit)
   - [POSTGRES_SYNC_BACKLOG.md](./README.md#postgres-sync-backlog)
2. **Rollback** — If deploy-related, consider rollback
3. **Scale** — If overload, scale instances or enable auto-scale
4. **Degrade gracefully** — Circuit breakers and fallbacks should already limit blast radius

## Resolution

1. **Fix underlying issue** — Per specific runbook
2. **Verify** — Confirm error rate returns to normal
3. **Post-mortem** — Document cause, timeline, and prevention steps

## Prevention

- Set alerts: error rate >5%, latency P95 >3s
- Run load tests before major releases
- Monitor dependency health (Stedi, Groq, Postgres) proactively


---

<a id="groq-rate-limit"></a>

## Groq Rate Limit (429)

*Former path: `docs/runbooks/GROQ_RATE_LIMIT.md`*


## Symptoms

- 5 consecutive HTTP 429 responses from Groq API
- Circuit breaker OPEN for `groq`
- PDF coding, voice coding suggestions, or admin AI fail
- Logs: `Groq rate limited` or `Circuit open: groq`
- Application Insights shows 429 errors to `api.groq.com`

## Impact

- **Medical coding** — PDF and voice coding suggestions unavailable
- **Admin AI** — Assistant may not respond
- **Fallback** — Knowledge-service keyword search used when circuit open

## Diagnosis

1. **Check Groq status**: https://status.groq.com/ (if available) or Groq dashboard
2. **Check health endpoint**: `GET /health?detailed=true` — inspect `dependencies.groq` and `circuit_breaker_states`
3. **Check usage** — Groq dashboard for rate limits and quota
4. **Review logs** — Search for `429` or `rate limit` in Application Insights

## Mitigation

1. **Circuit breaker fallback** — When OPEN, coding uses knowledge-service (keyword search) instead of LLM
2. **Reduce load** — Temporarily disable non-critical Groq usage (e.g. admin AI) if needed
3. **Exponential backoff** — Circuit auto-probes every 30s; avoid manual retries that worsen load

## Resolution

1. **Wait for reset** — Groq rate limits typically reset per minute; circuit will try HALF_OPEN after 30s
2. **Upgrade plan** — If sustained, consider Groq tier upgrade for higher limits
3. **Verify** — Trigger a coding suggestion; confirm Groq responds

## Prevention

- Monitor Groq usage and rate-limit headers
- Add token budget per call (Section 10) to reduce burst usage
- Consider fallback model or queue for non-real-time requests


---

<a id="low-confidence-spike"></a>

## Low Confidence Spike (>10% Rejected)

*Former path: `docs/runbooks/LOW_CONFIDENCE_SPIKE.md`*


## Symptoms

- Rejection rate >10% in `/api/admin/metrics` or Application Insights
- Many coding suggestions return `rejected: true` or `needs_review: true`
- `escalation_rate` or `rejection_rate` exceeds threshold
- Clinics report increased manual review workload

## Impact

- **Quality** — Low-confidence codes correctly rejected; no auto-approval of uncertain suggestions
- **Operational** — More cases escalated to human review; potential backlog
- **Model drift** — May indicate prompt or model degradation

## Diagnosis

1. **Check metrics**: `GET /api/admin/metrics` — `rejection_rate`, `escalation_rate`
2. **Check LangSmith** — Review rejected runs; inspect prompts and responses
3. **Sample rejected cases** — Look for patterns (specific CPT/ICD-10, payer, clinic)
4. **Review confidence thresholds** — `CONFIDENCE_THRESHOLD_LOW` (0.6), `CONFIDENCE_THRESHOLD_ESCALATE` (0.75)

## Mitigation

1. **Review queue** — Ensure human reviewers process escalated cases promptly
2. **Communicate** — Notify clinics that more cases need review; expected when thresholds enforced
3. **Do not lower thresholds** — Keeping 0.6/0.75 prevents hallucinated codes from auto-approval

## Resolution

1. **Tune prompts** — If pattern found, update medical-coding prompt for edge cases
2. **Evaluate accuracy** — Run `node scripts/evaluate-accuracy.js` (or `tests/medical-coding/evaluate-accuracy.js`) for baseline
3. **Model update** — If Groq model changed, re-evaluate and adjust if needed

## Prevention

- Run accuracy evaluation on each deploy
- Monitor rejection rate trend; alert if >10%
- Document common rejection patterns and prompt updates


---

<a id="middleware-platform-runbook-processor-outage"></a>

## Runbook — Payment processor outage (Stripe/Circle)

*Former path: `docs/runbooks/middleware-platform/RUNBOOK_PROCESSOR_OUTAGE.md`*

## Symptoms

- Elevated `payment_process_failed` and/or checkout errors
- Stripe API errors (timeouts, 5xx) in logs
- Circle transfer failures / settlement retries spiking

## Immediate actions

1. Confirm current provider status in vendor dashboards (Stripe / Circle status pages).
2. Reduce blast radius:
   - Pause non-critical flows if needed (feature flags / traffic shaping).
3. Communicate internally:
   - Open an incident (see `INCIDENT_RESPONSE.md`).

## Customer handling

- Avoid double charges: confirm PI/transfer status before retries.
- For refunds/disputes: record workflow ids and avoid manual ad-hoc actions.

## Recovery

- Resume normal operation after vendor stability returns.
- Re-run reconciliation for outage window.
- Review settlement DLQ: `GET /api/admin/payment-ops/settlement/dead-letter`.



---

<a id="middleware-platform-runbook-reconciliation-drift"></a>

## Runbook — Reconciliation drift / SLA breaches

*Former path: `docs/runbooks/middleware-platform/RUNBOOK_RECONCILIATION_DRIFT.md`*

## Symptoms

- `GET /api/admin/payment-ops/alerts` includes `reconciliation_sla_breaches`
- `GET /api/rcm/reconciliation/exceptions?status=open` shows exceptions older than SLA

## Immediate actions

1. Identify the top classifications and event keys in the exception queue.
2. Confirm ingestion is flowing:
   - Stripe PI: `payment_intent.succeeded` processor rows exist
   - Refunds/disputes: webhook events exist and canonical rows exist
3. Run a manual reconciliation window if needed:
   - `POST /api/rcm/reconciliation/run` with a narrow window

## Common causes

- Webhook ingestion disabled: `FINANCIAL_INTEGRITY_WEBHOOK_INGESTION=0`
- Processor event gaps (Stripe/Circle outage or misconfiguration)
- Internal event keys mismatched vs processor keys

## Recovery

- Fix ingestion first (webhook config, env flags).
- Re-run reconciliation after ingestion is healthy.
- Assign owners for open exceptions and document resolution notes.

## Escalation

- If drift spans multiple days or deltas are large: escalate to finance + engineering on-call.



---

<a id="middleware-platform-runbook-replay-attack-attempt"></a>

## Runbook — Replay attack attempt (webhooks / payment routes)

*Former path: `docs/runbooks/middleware-platform/RUNBOOK_REPLAY_ATTACK_ATTEMPT.md`*

## Symptoms

- Sudden spike in repeated webhook event ids
- Increased “stale event outside replay window” logs
- Unexpected repeated calls to `/api/payment/*` idempotency keys

## Immediate actions

1. Confirm webhook idempotency table behavior (Stripe event ids are stored and deduped).
2. Confirm replay window `STRIPE_WEBHOOK_REPLAY_WINDOW_SEC` is enabled and reasonable.
3. Review rate limiter logs and bot-guard signals.

## Containment

- Tighten inbound rate limits temporarily.
- If necessary, rotate webhook secret and redeploy.

## Follow-up

- Open a security incident and capture timeline (`INCIDENT_RESPONSE.md`).
- Add IOCs to monitoring (IPs, user agents, event id patterns).



---

<a id="middleware-platform-runbook-stripe-webhook-failures"></a>

## Runbook — Stripe webhook failures

*Former path: `docs/runbooks/middleware-platform/RUNBOOK_STRIPE_WEBHOOK_FAILURES.md`*

## Symptoms

- `GET /api/admin/payment-ops/alerts` includes `stripe_webhook_failures`
- Stripe dashboard shows webhook delivery failures or signature errors
- `stripe_webhook_events.status='failed'` rows increasing

## Immediate actions (10 minutes)

1. Confirm the webhook endpoint is reachable (deploy health).
2. Check `STRIPE_WEBHOOK_SECRET` is set and correct.
3. Look for signature verification failures in logs.
4. If failures are due to transient processor delay, **do not** disable webhooks; Stripe will retry.

## Investigation checklist

- Identify failing event types in `stripe_webhook_events.event_type`.
- Verify replay window config `STRIPE_WEBHOOK_REPLAY_WINDOW_SEC` isn’t rejecting legitimate events.
- Confirm raw-body middleware ordering is correct (must mount stripe webhook router before `express.json()`).

## Recovery

- Fix configuration/deploy issue.
- Let Stripe retry naturally.
- If gaps exist, use Stripe dashboard to re-send recent events.

## Escalation

- If sustained failures > 30 minutes or payments are stuck: escalate to **Payments on-call** per `ONCALL_AND_ESCALATION.md`.



---

<a id="postgres-sync-backlog"></a>

## Postgres Sync Backlog (>100 Pending)

*Former path: `docs/runbooks/POSTGRES_SYNC_BACKLOG.md`*


## Symptoms

- `retry_queue_depth` >100 in `GET /api/admin/metrics`
- `postgres_sync_retry` table has many rows
- Logs show repeated Postgres sync failures
- Postgres sync worker processing but not draining queue

## Impact

- **Data inconsistency** — SQLite and Postgres out of sync for clinics, appointments, voice_call_log, etc.
- **Reporting** — Postgres-based reports or external systems missing recent data
- **Billing** — Delayed sync of voice_checkout or function_call_log may affect reconciliation

## Diagnosis

1. **Check metrics**: `GET /api/admin/metrics` — `retry_queue_depth`, `dlq_size`
2. **Query retry table**: `SELECT entity_type, COUNT(*), MAX(last_error) FROM postgres_sync_retry GROUP BY entity_type`
3. **Check Postgres** — Connection, credentials, disk space, locks
4. **Check worker** — `postgres-sync-worker.js` runs every 60s; verify it is running
5. **Review `last_error`** — Common causes: connection refused, timeout, constraint violation

## Mitigation

1. **Fix Postgres** — Restart if hung; resolve connection/credential issues
2. **Increase worker concurrency** — If single-threaded, consider processing larger batches
3. **Prioritize** — Worker processes by `priority` (1=high, 2=medium, 3=low); high-priority syncs first

## Resolution

1. **Worker drains queue** — Once Postgres healthy, worker retries with exponential backoff (1s, 2s, 4s, 8s, 16s)
2. **DLQ** — After 5 failed attempts, rows move to `postgres_sync_dlq`; manual replay may be needed
3. **Verify** — Confirm `retry_queue_depth` drops; check Postgres for synced data

## Prevention

- Monitor `retry_queue_depth`; alert if >100
- Ensure Postgres has adequate connections and resources
- Runbook: [DR.md](./README.md#dr) for Postgres restore if DB corruption


---

<a id="readme"></a>

## Incident Runbooks

*Former path: `docs/runbooks/README.md`*

**Last Updated:** April 9, 2026

Runbooks for Doctor Little middleware platform incidents. Use with Application Insights or Azure Monitor alerts.

## Alert → Runbook Mapping

| Alert | Threshold | Runbook |
|-------|-----------|---------|
| Stedi circuit open | >5 min | [STEDI_DOWN.md](./README.md#stedi-down) |
| Groq rate limit | 5 consecutive 429s | [GROQ_RATE_LIMIT.md](./README.md#groq-rate-limit) |
| Low confidence spike | >10% rejected | [LOW_CONFIDENCE_SPIKE.md](./README.md#low-confidence-spike) |
| Postgres sync backlog | >100 pending | [POSTGRES_SYNC_BACKLOG.md](./README.md#postgres-sync-backlog) |
| Error rate spike | >5% | [ERROR_RATE_SPIKE.md](./README.md#error-rate-spike) |

## Disaster Recovery

- [DR.md](./README.md#dr) — Backup, restore, RTO/RPO


---

<a id="reasoning-canary-rehearsal-note"></a>

## Reasoning Canary Rehearsal Note

*Former path: `docs/runbooks/REASONING_CANARY_REHEARSAL_NOTE.md`*

Date: 2026-04-18
Owner: Platform on-call

## Checklist

- Ran `node ./middleware-platform/scripts/check-reasoning-flag-state.cjs`
  - Result: `env_flag_value=false`, `remote_checked=false` (no live admin token in this environment)
- Verified rollback steps are documented in `docs/runbooks/README.md#reasoning-rollout-runbook`
- Verified alert coverage in `docs/runbooks/README.md#alert-rules` for:
  - DLQ backlog threshold
  - route-safety regressions
  - reasoning fallback/latency/cost spikes
- Verified schema governance in `docs/reasoning/README.md` ([Schema version policy](../reasoning/README.md#schema-version-policy))
- Re-checked DLQ health after terminal resolution:
  - Before terminal resolution: 117
  - After terminal resolution + re-check: 0 (below threshold 50)

## Notes

- Terminal DLQ entries were archived to `docs/archive/runbooks-incidents/DLQ_TOOL_CALLS_TERMINAL_ARCHIVE_1776474930109.json`.
- Root cause for non-replayable entries: `checkout_backfill_reconciliation` is unknown to `KellyToolExecutor` in this environment.


---

<a id="reasoning-gate-failure-triage"></a>

## Reasoning gate failure triage

*Former path: `docs/runbooks/REASONING_GATE_FAILURE_TRIAGE.md`*

Use this runbook when alerts or dashboards show elevated **`reasoning.gate.*`** metrics or correlated **`result_summary.reasoning.status.deferred`** spikes. It complements provider/latency triage in [REASONING_KILL_SWITCH_RECOVERY.md](./README.md#reasoning-kill-switch-recovery).

## Canonical metrics (per gate)

| Gate | Primary counters | Typical symptom |
|------|------------------|-----------------|
| Schema | `reasoning.gate.schema.fail.count` | Model JSON / contract version mismatch; patch not merged |
| Semantic contract | `reasoning.gate.semantic_contract.fail.count` | Route field or forbidden vocabulary blocked |
| Confidence / evidence | `reasoning.gate.confidence.defer.count` | Low score or insufficient provenance |
| Safety | `reasoning.gate.safety.fail.count` | Post-sanitize safety patterns hit |
| Merge lineage | `reasoning.merge.stale_reject.count`, `reasoning.merge.conflict_reject.count`, `reasoning.fsm.transition.rejected_stale_patch.count` | Superseded snapshot, lineage mismatch, or patch older than `snapshot.generated_at` (stale async job) |

Provider transport and kill-switch issues are **not** gate failures; use [REASONING_KILL_SWITCH_RECOVERY.md](./README.md#reasoning-kill-switch-recovery).

Dashboard layout for gate vs FSM vs merge panels: [Observability dashboards](../reasoning/README.md#observability-dashboards).

## Triage order (15 minutes)

1. **Classify** which gate counter moved (Azure / logs / `reasoning_gate_decision` on affected snapshots if persisted).
2. **Schema** — inspect `reasoning.schema_invalid.count` and recent `reasoning_provider_error_class`; open [Schema version policy](../reasoning/README.md#schema-version-policy) if contract drift is suspected.
3. **Semantic** — check `RESULT_SUMMARY_SEMANTIC_GUARD_V1` and shadow ratio `reasoning.semantic_reject.count` vs `reasoning.unsupported_for_route.count`.
4. **Confidence** — confirm route-specific min confidence / evidence tables in `product-summary-service` and food-route provenance requirements.
5. **Safety** — review blocked phrases in gate logic and `sanitizeReasoningText` coverage.
6. **Merge** — if `stale_reject` / `conflict_reject` rose, verify snapshot churn (edits, double baseline builds) and job `snapshot_id` vs latest.

## Stabilization actions

- **Schema spike after deploy** — roll back model prompt or schema version; see schema policy doc.
- **Semantic spike on one route** — temporary semantic guard shadow (`RESULT_SUMMARY_SEMANTIC_GUARD_SHADOW=true`) only for measurement, not as a silent bypass in production without owner signoff.
- **Safety spike** — treat as correctness: expand patterns only after security review.
- **Merge spike** — expected under high edit concurrency; tune job dedupe or document SLO.

## Escalation

- P1 sustained gate failures affecting >1 route → page platform on-call and link this runbook + last deploy SHA.
- Attach **gate-level** counts (not only `reasoning.api_error`) to the incident thread; use [REASONING_POST_INCIDENT_TEMPLATE.md](./README.md#reasoning-post-incident-template) for postmortem.


---

<a id="reasoning-kill-switch-recovery"></a>

## Reasoning kill-switch recovery (`disable → stabilize → re-enable`)

*Former path: `docs/runbooks/REASONING_KILL_SWITCH_RECOVERY.md`*

This runbook covers **`RESULT_SUMMARY_REASONING_PROVIDER_KILL_SWITCH`**, provider outages, and **API / latency / cost** alerts that map here from [ALERT_RULES.md](./README.md#alert-rules) (not gate-only triage).

## When to use

- `RESULT_SUMMARY_REASONING_PROVIDER_KILL_SWITCH=true` was flipped, or must be flipped.
- Alerts: **Reasoning API error rate**, **Reasoning latency p95 spike**, or provider circuit events.
- User-visible degradation is acceptable only after **scaffold** flags are safe; model path is optional.

## Disable (immediate)

1. Set **`RESULT_SUMMARY_REASONING_PROVIDER_KILL_SWITCH=true`** (stops outbound model calls; deterministic/stub continues).
2. Optionally set **`RESULT_SUMMARY_REASONING_MODEL_V1=false`** if the issue is model-contract or prompt-related (keeps async jobs from attempting model path where configured).
3. Confirm **`RESULT_SUMMARY_REASONING_V1`** state with stakeholders before turning off entirely (disables merge UX path).

## Stabilize

1. Watch **`reasoning.api_error.count` / `reasoning.provider.call.count`**, **`reasoning.provider.latency_ms.*`**, and DLQ / job retry rates.
2. For **schema / parse** issues, coordinate with gate triage: [REASONING_GATE_FAILURE_TRIAGE.md](./README.md#reasoning-gate-failure-triage).
3. Capture incident id, time window, and top `reasoning.provider.error_class.*` breakdown.

## Re-enable (one-command readiness)

From repo root (or `middleware-platform/` for relative paths below):

```bash
npm run verify:reasoning:re-enable-readiness --prefix middleware-platform
```

This runs, in order:

1. `scripts/check-reasoning-flag-state.cjs` — local env + optional remote admin flag probe.
2. `scripts/verify-reasoning-pinecone-readiness.cjs` — vector readiness when Pinecone is configured (exits non-zero if configured but empty; see script output).
3. `npm run test:reasoning:guardrails` — static guardrails.

**Optional skips**

- Pinecone not used in your environment: `REASONING_READINESS_SKIP_PINECONE=1 npm run verify:reasoning:re-enable-readiness --prefix middleware-platform`

**Before production model re-enable**

- Run **`npm run test:reasoning-pre-ramp`** from repo root (regression + eval harness); see [Rollout gate](../reasoning/README.md#rollout-gate-shadow-canary-ci-rollback) in `docs/reasoning/README.md`.
- Live admin flag check: set `REASONING_FLAG_CHECK_BASE_URL` and `REASONING_FLAG_CHECK_BEARER` as in `check-reasoning-flag-state.cjs` header comment.

## Mandatory pre re-enable checklist (production)

Do **not** clear the kill switch for production traffic until **all** of the following are true:

1. **Gate failure rates** — for a full observation window (≥30 min), each of `reasoning.gate.schema|semantic_contract|confidence|safety|provider_error` is **at or below** the canary ceilings in [Rollout gate](../reasoning/README.md#rollout-gate-shadow-canary-ci-rollback) section 2 (or documented waiver with owner).
2. **DLQ stable** — `reasoning_jobs` **DLQ** depth flat or falling (no runaway `reasoning.worker.dlq.count`); if tool-call DLQ is in scope for the same incident, backlog **not** climbing per [ERROR_RATE_SPIKE.md](./README.md#error-rate-spike) tool-call row.
3. **Route regression counters zero** — `result_summary.regression.non_cosmetic.*` and `session_result_snapshot.regression.non_cosmetic.*` are **0** in the same window as [ALERT_RULES.md](./README.md#alert-rules) §5.
4. **Regression + E2E suites green** — `npm run test:reasoning-pre-ramp` from repo root; plus `npm run test:reasoning-release-gates` when UI/API are available (or `REASONING_RELEASE_SKIP_E2E=1` with a **tracked** follow-up E2E run before 100% ramp). See [Test plan](../reasoning/README.md#test-plan-and-rollout-checklist) in `docs/reasoning/README.md`.

Optional: confirm dashboard panels in [Observability dashboards](../reasoning/README.md#observability-dashboards) show healthy FSM transition mix (`pending_to_complete` dominates after ramps).

## Re-enable sequence

1. Clear kill switch: **`RESULT_SUMMARY_REASONING_PROVIDER_KILL_SWITCH=false`**.
2. Canary **`RESULT_SUMMARY_REASONING_MODEL_V1`** per [Rollout gate](../reasoning/README.md#rollout-gate-shadow-canary-ci-rollback).
3. Hold and watch provider metrics for a full window before next ramp.

## Rollback

If re-enable fails, re-apply kill switch and **`RESULT_SUMMARY_REASONING_MODEL_V1=false`** without redeploy (env / feature store).


---

<a id="reasoning-post-incident-template"></a>

## Post-incident template — reasoning (gate-level root cause)

*Former path: `docs/runbooks/REASONING_POST_INCIDENT_TEMPLATE.md`*

Copy into the incident doc or ticket. **Gate-level** summary is required for reasoning incidents (not only “API errors”).

## Summary

- **Incident ID:**
- **Window (UTC):**
- **Severity / customer impact:**
- **Detection:** alert name + link to dashboard

## Scope

- [ ] Provider / transport (latency, 429, circuit, kill switch)
- [ ] Gate: schema
- [ ] Gate: semantic contract
- [ ] Gate: confidence / evidence
- [ ] Gate: safety
- [ ] Gate: merge lineage (stale / conflict)
- [ ] Frontend / contract version mismatch

## Metrics (paste charts or numbers)

| Metric | Baseline (24h prior) | Incident peak | Notes |
|--------|----------------------|-----------------|-------|
| `reasoning.gate.schema.fail.count` | | | |
| `reasoning.gate.semantic_contract.fail.count` | | | |
| `reasoning.gate.confidence.defer.count` | | | |
| `reasoning.gate.safety.fail.count` | | | |
| `reasoning.gate.provider_error.count` | | | |
| `reasoning.merge.stale_reject.count` | | | |
| `reasoning.merge.conflict_reject.count` | | | |
| `reasoning.api_error.count` / `reasoning.provider.call.count` | | | |

## Root cause (gate-level)

*Which gate(s) failed first, and why?* Link to sample `reasoning_gate_decision` payloads or job `last_error` if applicable.

## Mitigation deployed

- Flags / config changed:
- Deploy SHA (if any):

## Follow-ups

- [ ] Runbook updates (link PR)
- [ ] Alert threshold tuning (link ticket)
- [ ] Test or eval harness gap (link issue)

## Signoff

- Primary owner:
- Date:


---

<a id="reasoning-rollout-runbook"></a>

## Reasoning Rollout Runbook (`REACT_APP_RESULTS_SUMMARY_V1`)

*Former path: `docs/runbooks/REASONING_ROLLOUT_RUNBOOK.md`*

## Scope

This runbook governs rollout and rollback of results-summary reasoning UI and backend augmentation.

## Related runbooks (reasoning-specific)

- **Gate failures:** [REASONING_GATE_FAILURE_TRIAGE.md](./README.md#reasoning-gate-failure-triage)
- **Kill switch, provider, latency, re-enable sequence:** [REASONING_KILL_SWITCH_RECOVERY.md](./README.md#reasoning-kill-switch-recovery)
- **Post-incident (gate-level RCA):** [REASONING_POST_INCIDENT_TEMPLATE.md](./README.md#reasoning-post-incident-template)
- **Shadow mode, CI gates, canary thresholds, staged ramp, rollback matrix:** [docs/reasoning/README.md](../reasoning/README.md#rollout-gate-shadow-canary-ci-rollback)
- **One-command readiness before re-enable:** `npm run verify:reasoning:re-enable-readiness --prefix middleware-platform`

## Owners

- **Primary owner:** Platform on-call
- **Secondary owner:** Landing assistant owner
- **Rollback authority:** Either owner can rollback without deploy by flipping feature flags
- **Escalation path:** Platform on-call (PagerDuty) -> `#alerts` Slack -> engineering@ / ops@ distribution list

## Feature Flags

- Frontend: `REACT_APP_RESULTS_SUMMARY_V1`
- Backend scaffold: `RESULT_SUMMARY_REASONING_V1`
- Backend model path: `RESULT_SUMMARY_REASONING_MODEL_V1`
- Emergency provider kill switch: `RESULT_SUMMARY_REASONING_PROVIDER_KILL_SWITCH`
- Shadow rollout (compute patches, no snapshot merge): `RESULT_SUMMARY_REASONING_SHADOW_V1`

## Immediate Safety Stop Verification

Use this before any production canary:

```bash
node ./middleware-platform/scripts/check-reasoning-flag-state.cjs
```

For live admin confirmation (required for production signoff), provide:

```bash
REASONING_FLAG_CHECK_BASE_URL="https://<admin-host>" \
REASONING_FLAG_CHECK_BEARER="<admin-token>" \
node ./middleware-platform/scripts/check-reasoning-flag-state.cjs
```

Expected output includes `remote_checked: true` and the live `RESULT_SUMMARY_REASONING_V1` row.

### Owner + Rollback Authority

- **Flag check owner:** Platform on-call
- **Secondary verifier:** Landing assistant owner
- **Rollback authority:** Either owner can disable `RESULT_SUMMARY_REASONING_V1` and enable provider kill switch immediately

## Rollout Steps By Environment

1. **Local**
   - Set `REACT_APP_RESULTS_SUMMARY_V1=1`
   - Set `RESULT_SUMMARY_REASONING_V1=true`
   - Keep `RESULT_SUMMARY_REASONING_MODEL_V1=false` until model contract validation passes
   - Run targeted tests and one manual scan pass
2. **Staging (100%)**
   - Enable frontend and backend scaffold flags
   - Keep provider kill switch available (`RESULT_SUMMARY_REASONING_PROVIDER_KILL_SWITCH=true`) until smoke passes
   - Validate route-safety checklist for food/cosmetic/supplement scans
3. **Production Canary**
   - Before each ramp step, run `npm run test:reasoning-pre-ramp` from repo root (regression + eval harness); see [docs/reasoning/README.md](../reasoning/README.md#rollout-gate-shadow-canary-ci-rollback) for scan-chat E2E and staged holds
   - 5% for 30 minutes
   - 20% for 30 minutes
   - 50% for 60 minutes
   - 100% after stable metrics and no regression alerts

## Rollback Triggers

Rollback immediately if any of the following occur during rollout window:

- `reasoning.api_error.count / reasoning.provider.call.count` exceeds 2% for 10 minutes
- `reasoning.provider.latency_ms.*` p95 exceeds 8 seconds for 10 minutes
- DLQ backlog rises above 50 and continues climbing
- Any route-safety regression metric is non-zero for 10 minutes:
  - `result_summary.regression.non_cosmetic.cosmetic_harmful_copy.count`
  - `result_summary.regression.non_cosmetic.key_actives_available.count`
  - `session_result_snapshot.regression.non_cosmetic.nyc_context_present.count`

### Metric Naming (Canonical)

- Use `reasoning.provider.latency_ms.*` for latency dashboards/alerts (not `reasoning.api_latency_ms`)
- Use `reasoning.api_error.count` over `reasoning.provider.call.count` for reasoning-path error rate

## Rollback Procedure (No Deploy)

1. Set `REACT_APP_RESULTS_SUMMARY_V1=0` (frontend rollback)
2. Set `RESULT_SUMMARY_REASONING_V1=false` (backend reasoning scaffold rollback)
3. Set `RESULT_SUMMARY_REASONING_PROVIDER_KILL_SWITCH=true` (hard-stop provider path)
4. Confirm:
   - New snapshots show deterministic-only behavior
   - `reasoning.mode.stub.count` and/or deterministic fallback modes dominate
   - No new reasoning provider errors are emitted
5. Record incident summary in change log

## Post-Rollback Checks

- Verify scan result rendering remains route-safe
- Verify no user-visible "AI-assisted" labeling when model mode is off
- Verify scan flow still emits `scan.category_route.client_fallback_used` without 400s

## Canary Rehearsal Checklist

Rehearse in staging before production 100%:

1. Run `node ./middleware-platform/scripts/check-reasoning-flag-state.cjs`
2. Run `npm run test:reasoning-regression` and require pass before simulated ramp
3. Validate alerts listed in `docs/runbooks/README.md#alert-rules` are present and mapped to reasoning-specific runbooks (gate triage, kill-switch recovery, rollout gate)
4. Verify schema policy is current: [Schema version policy](../reasoning/README.md#schema-version-policy) in `docs/reasoning/README.md`
5. Simulate rollback by toggling:
   - `RESULT_SUMMARY_REASONING_V1=false`
   - `RESULT_SUMMARY_REASONING_PROVIDER_KILL_SWITCH=true`
6. Confirm deterministic-only behavior and no reasoning provider errors



---

<a id="staging-smoke-test"></a>

## STAGING_SMOKE_TEST

*Former path: `docs/runbooks/STAGING_SMOKE_TEST.md`*

## Staging deploy + smoke test runbook (mvp-80)

### Preconditions

- **Staging environment exists** with its own:
  - DB
  - Stripe keys (test mode)
  - LiveKit keys
  - Email provider (sandbox is OK)
- **Allowed origins** include the staging portal domain(s)
- **Admin auth** is available for debug endpoints

### Deploy steps (staging)

- **Build + deploy** the API to staging (same artifact as prod)
- **Run DB migrations** with:
  - `MIGRATIONS_STRICT=1`
  - `BACKUP_BEFORE_MIGRATE=1`
- **Verify background workers** start:
  - reminder scheduler (leader elected)
  - notification queue worker

### Smoke tests (10–15 minutes)

#### Auth / Session

- **OTP send**: request OTP for a test patient email
- **OTP confirm**: confirm OTP, verify:
  - `patient_session_id` cookie is set (httpOnly, SameSite)
  - `patient_csrf` cookie is set
- **Session expiry**: wait / simulate TTL and confirm 401 forces re-login

#### Appointments

- **Appointments load** on mobile viewport
- **Reschedule**:
  - does it succeed?
  - does the appointment move to the new time?
  - does a reschedule email get delivered (queued → sent)?
- **Cancel**:
  - does it succeed?
  - does the appointment disappear or show canceled?
  - does a cancel email get delivered (queued → sent)?

#### Video join

- **Join window enforcement**:
  - before join window: Join is blocked
  - within join window: token is issued
- **Token scoping**:
  - cannot mint tokens for arbitrary rooms

#### Payments

- **Checkout load** from payment link
- **Payment process** (test flow):
  - success transitions receipt/appointment states
  - receipt is visible in patient portal

#### Documents

- **Upload** a document
- **Download** via token:
  - link works once
  - token is revoked/used after download
- **Export** endpoint returns metadata + signed URLs

#### Ops / Observability

- **Application Insights** (or configured provider) receives:
  - request traces
  - exceptions
- **Ops dashboard**:
  - `GET /api/admin/ops/summary` returns counters + dead-letter notifications

### Go / No-go

- **Go** if all critical flows pass (auth, appointments, video, payments, docs) and notification queue has **no growing dead-letter**.
- **No-go** if:
  - OTP is unstable / blocked incorrectly
  - video tokens fail within join window
  - payment lifecycle doesn’t reconcile
  - documents cannot be securely downloaded



---

<a id="stedi-down"></a>

## Stedi API Down

*Former path: `docs/runbooks/STEDI_DOWN.md`*


## Symptoms

- Circuit breaker OPEN for `stedi` (5 failures in 60s)
- `/health?detailed=true` shows `dependencies.stedi: unhealthy` or `circuit_breaker_states.stedi: OPEN`
- Eligibility checks return simulated/fallback data
- Application Insights shows `Circuit open: stedi` or Stedi API errors

## Impact

- **Degraded eligibility** — Real-time insurance verification unavailable; fallback to simulated eligibility
- **Claim submission** — X12 claim translation may fail; claims queued for retry
- **Voice agent** — May report "insurance check unavailable" to callers

## Diagnosis

1. **Check Stedi status**: https://status.stedi.com/
2. **Check health endpoint**: `GET /health?detailed=true` — inspect `dependencies.stedi` and `circuit_breaker_states`
3. **Check Application Insights** for Stedi-related errors (timeouts, 5xx, connection refused)
4. **Verify API key**: `STEDI_API_KEY` and `STEDI_API_BASE` in `.env`

## Mitigation

1. **Notify clinic staff** — Eligibility is simulated; advise manual verification if needed
2. **Fallback already enabled** — Circuit breaker returns simulated eligibility; no code change required
3. **Queue for retry** — Postgres sync retry queue holds failed syncs; they will retry when Stedi recovers

## Resolution

1. **Circuit auto-closes** — After 30s in OPEN, circuit goes HALF_OPEN; next successful request closes it
2. **Retry queued items** — Postgres sync worker runs every 60s; failed syncs retry automatically
3. **Verify recovery** — Trigger an eligibility check; confirm real data returns

## Prevention

- Monitor Stedi status page for incidents
- Consider Stedi SLA for production
- Circuit breaker metrics in `/api/admin/metrics` — alert if `stedi` OPEN >5 min


