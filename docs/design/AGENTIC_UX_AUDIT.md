# Agentic UX audit baseline

**Last updated:** 2026-06-17  
**Plan:** Agentic UX-first execution (provider trust loop before Demo Phase 1)

## Brand SSOT

| Surface | Tokens / shell |
|---------|----------------|
| Provider portal | [`somo-tokens.css`](../../unified-dashboard/assets/css/somo-tokens.css), [`provider-portal.css`](../../unified-dashboard/assets/css/provider-portal.css), `pp-page-shell`, `pp-topbar--page` |
| Marketing landing | [`SOMO_MARKETING_COLORS.md`](./SOMO_MARKETING_COLORS.md) — lizard `#1C35EA`, MSU `#000000` |
| Voice persona | UI: **Somo front desk**; spoken: **Kelly** (never Sam on demo) |

## Shell parity (2026-06-17)

| Page | `pp-page-shell` | `provider-api.js` | Notes |
|------|-----------------|-------------------|-------|
| today.html | Yes | Yes | Kelly activity panel |
| calendar.html | Yes | Yes | Booked by Kelly badge on board + list |
| agent.html | Yes | Yes | Control plane |
| calls.html | Yes (fixed) | Yes | Forensics + orchestration trace |
| revenue.html | Yes | Yes | Voice checkouts scoped by clinic |
| patients.html | Yes | Yes | |
| trial-activation.html | Marketing shell | N/A | Kelly status gate on Call CTA |

## Agentic UX gaps addressed in this sprint

1. Activity feed — `tool_completed` + dedicated cancel/reschedule events
2. Call forensics — orchestration trace + conversation summary on `/api/kelly/calls/:id`
3. Calendar poll — 30s refresh on today + calendar pages
4. Clinical prep — triage synced into rails projection on booking pivot
5. Trial activation — Call CTA gated on Kelly ready + real phone
6. Demo Phase 1 — email funnel + admin inbound demos lane (Phase 7)

## Verify

```bash
cd middleware-platform
npm run test:e2e -- --project provider-portal
npm run test:e2e:provider-journey
npm test -- kelly-activity-feed
```
