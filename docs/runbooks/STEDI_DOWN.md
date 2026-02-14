# Stedi API Down

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
