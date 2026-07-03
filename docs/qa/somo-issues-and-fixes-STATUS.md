# 86-Item Backlog — Implementation Status

**Completed:** 2026-07-03  
**Tracking copy:** `/Users/ojrichard/Downloads/somo-issues-and-fixes.md`

## Summary

| Tier | Done | Deferred |
|------|------|----------|
| P0 | 18/18 | — |
| P1 | 39/39 | — |
| P2 | 26/29 | P2-024, P2-025 partial; P2-027–029 credential-blocked |

## Verification (local)

```bash
cd middleware-platform
npm test -- __tests__/onboarding-blockers.test.js __tests__/lead-convert.test.js __tests__/rcm/payment-settlement.test.js __tests__/dentrix-adapter.test.js --runInBand
npm run verify:doc-links
npm run verify:security-lint
npm run verify:prod-gates
```

## Partial / credential-blocked

- **P2-024** — `kelly-agent-service.js` shrink deferred until prod soak
- **P2-025** — Retell FC + KellyToolExecutor: firewall unified; full dispatch table merge deferred
- **P2-027–029** — Require Stedi/Dentrix/Stripe production credentials
