# PO surface scorecard

**Last updated:** 2026-05-31  
**Purpose:** RAG status per revenue surface — owner, last proof, verify command.

| Surface | RAG | Owner | Last staging proof | Verify command |
|---------|-----|-------|-------------------|----------------|
| Voice (SaaS inbound) | Amber | Platform | P0 code shipped `139f424`; PSTN proof pending | `npm run billing:test-gate`, `npm run test:e2e:staging-voice` |
| Signup / trial | Amber | Growth | Trial SIM archived; drift audit available | `npm run audit:trial-provision-drift`, `npm run test:e2e:staging-signup` |
| Checkout / commerce | Amber | Commerce | Cart prepare + shipping meta wired; webhook unified | Manual checkout-chat; `node scripts/verify-agentic-checkout.cjs` |
| Patient / timeline | Green | Patient | Journal V1 + photo-to-bill backend shipped | Patient app `tsc`; billing capture e2e |
| RCM / Kelly | Amber | RCM | F2 conversation E2E partial; golden path S0–3 done | `npm run test:e2e:rcm:conversation` |
| Payor / geo | Green | Data | CMS pipeline + local smoke | `npm run verify:payor-navigator:local` |
| Telemedicine | Amber | Care delivery | `completeAppointment` on video end shipped | Manual video `end_session`; [`TELEMEDICINE_TODOS.md`](../../todos/pending/TELEMEDICINE_TODOS.md) |
| Production infra | Red | Ops | Azure/HIPAA checklist open | [`PRODUCTION_READINESS_TASKS.md`](../../todos/pending/PRODUCTION_READINESS_TASKS.md) |

**Legend:** Green = signed off in staging with CI; Amber = code exists, proof incomplete; Red = material gaps.

**Staging matrix:**

```bash
cd middleware-platform
npm run staging:preflight
npm run billing:test-gate
npm run audit:trial-provision-drift
SKIP_STARTUP_MIGRATIONS=1 npx jest __tests__/voice-inbound-tenant.test.js
```

Manual P0: inbound PSTN → `npm run staging:call-verify -- --customer-id=…`
