# Health session master plan (repo copy)

Consumer Somo health video chat — phases P0–P3.

## P0–P2 (shipped)

- Terms → `POST /api/health-session/start`
- LiveKit + browser STT / typed turns
- Groq PA loop in `services/health/agent/`
- Report on end → `health_session_reports`

## P3 (finance — gated)

`HEALTH_SESSION_FINANCE_ENABLED`: Stedi eligibility + Stripe copay on `health_session_id`.

## Structural remediation (2026-06)

- `services/health/` first-class package
- Transport: `/api/health-session/sse`, `/api/health-session/agent-events`
- Import firewall + isolation tests

See [SOMO_HEALTH_AGENT.md](./SOMO_HEALTH_AGENT.md).
