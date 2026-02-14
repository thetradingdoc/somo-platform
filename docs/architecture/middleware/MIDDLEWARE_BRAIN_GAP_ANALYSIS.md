# Middleware Brain Improvements - Gap Analysis & Implementation Status

**Last Updated:** January 2026  
**Status:** P0/P1 gaps addressed; P2/P3 documented for future work

---

## Executive Summary

This document captures the gap analysis for the Middleware Brain Improvements and implementation status. The main implementation doc is [MIDDLEWARE_BRAIN_IMPROVEMENTS_IMPLEMENTATION.md](./MIDDLEWARE_BRAIN_IMPROVEMENTS_IMPLEMENTATION.md).

---

## Implemented (Jan 2026)

| Gap | Implementation |
|-----|----------------|
| **PII redaction edge cases** | `utils/pii-redactor.js`: Added NHS number, Canadian SIN, MRN patterns; `redactWithLog()` for audit counts |
| **LangSmith project naming** | `utils/langsmith-config.js`: `LANGCHAIN_PROJECT=middleware-{env}` (prod/staging/dev) when not set |
| **HIPAA audit log patient_id** | `hipaa_access_log.patient_id` column; `logHipaaAccess` accepts patient_id; 7-year retention in policy + cleanup script |
| **API key rotation** | `db.rotateMerchantApiKey(merchantId)`; `POST /api/admin/clients/:clinicId/api-keys/rotate` |
| **Idempotency TTL** | 24h TTL, daily cleanup in database.js |

---

## Already Implemented (Prior)

- State sync (LangGraph ↔ DB): migrate, reconcile scripts, dual-write
- Circuit breakers: Stedi, Groq, FHIR, Epic, 1upHealth
- Postgres retry queue: exponential backoff, DLQ, max 5 retries
- Token budget: per-call tracking, graceful degradation
- Feature flags: DB-backed, rollout_pct, clinic allowlist
- Health checks: timeouts, 30s cache, parallel probes
- Runbooks + alert mapping: STEDI_DOWN, GROQ_RATE_LIMIT, etc.
- Load test: `tests/load/basic-load.js`

---

## Remaining Gaps (P2/P3)

| Category | Task | Priority |
|----------|------|----------|
| **Multi-region** | DR plan: active-passive or active-active; RTO/RPO targets | P3 |
| **Distributed tracing** | OpenTelemetry; propagate trace ID from Retell through all calls | P2 |
| **API key rotation** | Automated 90-day rotation; dual-key support during transition | P2 |
| **PII patient names** | Fuzzy name redaction (Mr./Mrs./patient + name) — high false positive risk | P2 |
| **pii_redaction_log table** | Persist redaction counts for audit (currently console only) | P2 |
| **LangSmith** | PHI controls for traces; retention/archival policy doc | P2 |
| **Query optimization** | Slow query log; indexes on hot paths | P3 |
| **Acceptance criteria** | Formal DoD per task in implementation doc | P3 |

---

## Related Documentation

- [Implementation Doc](./MIDDLEWARE_BRAIN_IMPROVEMENTS_IMPLEMENTATION.md)
- [LangChain/LangGraph Architecture](../ai/LANGCHAIN_LANGGRAPH_RAG_ARCHITECTURE.md)
- [Runbooks](../../runbooks/README.md)
- [Data Retention Policy](../../compliance/DATA_RETENTION_POLICY.md)
