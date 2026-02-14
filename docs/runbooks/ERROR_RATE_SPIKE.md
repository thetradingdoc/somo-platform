# Error Rate Spike (>5%)

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
   - [STEDI_DOWN.md](./STEDI_DOWN.md)
   - [GROQ_RATE_LIMIT.md](./GROQ_RATE_LIMIT.md)
   - [POSTGRES_SYNC_BACKLOG.md](./POSTGRES_SYNC_BACKLOG.md)
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
