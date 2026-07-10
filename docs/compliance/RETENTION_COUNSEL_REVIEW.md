# Retention policy — counsel review (G2)

**Generated:** 2026-07-05  
**Source:** `middleware-platform/config/retention-policy.js`  
**Owner:** Engineering (export) · Legal (sign-off)

Run dry-run evidence:

```bash
cd /path/to/somo
RETENTION_DRY_RUN=1 node scripts/retention-cleanup.cjs
```

Attach dry-run output to `PRODUCTION_PLAN_LOG.md` when counsel reviews.

## Retention matrix

| Data key | Retention (days) | Engineering notes | Counsel sign-off |
|----------|------------------|-------------------|------------------|
| `voice_call_log` | 365 | PSTN / voice metadata and transcripts | ☐ Approved |
| `coding_decisions` | 2555 | Billing compliance (~7 years) | ☐ Approved |
| `llm_usage_log` | 90 | Model usage metering | ☐ Approved |
| `function_call_log` | 90 | Tool invocation audit | ☐ Approved |
| `voice_conversation_memory` | 30 | Short-term voice context | ☐ Approved |
| `idempotency_keys` | 1 | Daily cleanup (~24h) | ☐ Approved |
| `postgres_sync_retry` | 7 | Mirror retry queue | ☐ Approved |
| `postgres_sync_dlq` | 90 | DLQ before manual review | ☐ Approved |
| `hipaa_access_log` | 2555 | HIPAA access audit (~7 years) | ☐ Approved |
| `video_consult_sessions` | 30 | Telehealth session P2 data | ☐ Approved |
| `video_consult_ai_decisions` | 30 | AI decision artifacts | ☐ Approved |
| `video_consult_review_tasks` | 90 | HITL review queue | ☐ Approved |
| `health_sessions` | 90 | Somo Health consumer sessions (deferred product) | ☐ Approved |
| `health_session_transcripts` | 90 | Health session transcripts | ☐ Approved |
| `health_session_reports` | 365 | Health session PDF/report exports | ☐ Approved |
| `kelly_conversation_history` | 90 | **Placeholder — confirm with counsel** | ☐ Approved |
| `triage_sessions` | 90 | OPQRST / triage intake | ☐ Approved |

## Counsel checklist

1. Confirm each retention period meets BAA / state record-keeping requirements.
2. Approve or revise `kelly_conversation_history` (currently 90-day placeholder).
3. Sign below and update `docs/compliance/VENDOR_BAA_TRACKER.md` last-verified dates.

| Reviewer | Role | Date | Signature |
|----------|------|------|-----------|
| | Counsel | | |
| | Privacy / Security | | |
