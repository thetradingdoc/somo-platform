# Groq Rate Limit (429)

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
