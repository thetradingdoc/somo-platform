# Runtime Entrypoints And Call Paths

**Last Updated:** 2026-04-29

## Primary Entrypoints

- **API runtime:** `middleware-platform/server.js`
- **Landing web app:** `unified-dashboard/littlelab-landing/src/index.js`
- **Patient app (Expo Router):** `patient-app/app/_layout.tsx`
- **Ops/verification scripts:** `scripts/` (repo root), `middleware-platform/scripts/`

## End-To-End Call Paths

### 1) Public landing assistant

1. Browser UI in `littlelab-landing` calls `/api/public/landing-assistant/turn`
2. `server.js` routes to public assistant turn handler
3. Kelly/reasoning orchestration runs in `middleware-platform/services/*`
4. Snapshot/metrics persistence updates DB tables
5. UI fetches result snapshots and renders results page

### 2) Public plans + geo + checkout

1. Landing UI calls `/api/public/plans/*` and `/api/public/geo/*`
2. Route modules in `middleware-platform/routes/public-plan-search.js` and `public-geo.js`
3. Service layer resolves geo, plan matching, and response contracts
4. Checkout flows through `/api/public/commerce/*` and `/api/public/checkout*`

### 3) Payment confirmation path

1. Client starts checkout and receives token/payment intent metadata
2. `/api/payment/*` routes process intent/confirm/capture/refund
3. Stripe webhooks reconcile final status and order linkage
4. Reliability and anti-fraud services enforce idempotency and guardrails

### 4) Patient and provider authenticated paths

1. Session/JWT auth middleware gates `/api/patient/*` and `/api/provider/*`
2. Routes call service modules for records, appointments, uploads, summaries
3. Audit/compliance services log sensitive access events

### 5) Payor canonical resolver path

1. Insurance/payer input reaches runtime insurance routes
2. `payor-registry-resolver-service` maps to canonical payor entity
3. Optional provider-payor precheck validates network status
4. Downstream claim/eligibility routing uses canonicalized identity

## Debug Entry Checklist

- Verify process/env: `PORT`, `DB_PATH`, feature flags
- Confirm route owner file in `middleware-platform/routes/`
- Confirm service owner in `middleware-platform/services/`
- Check docs parity tracker in `docs/meta/CODEBASE_BATCH_REVIEW_AND_DOC_GAPS.md`
