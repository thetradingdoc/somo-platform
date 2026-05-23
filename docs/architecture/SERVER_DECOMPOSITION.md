# Server.js decomposition

**Last updated:** 2026-05-21

## Problem statement

[`middleware-platform/server.js`](../../middleware-platform/server.js) is the Express entry point. Patient-portal HTTP, Kelly triage, landing assistant, checkout-chat, and most admin routes are now registered from `routes/` + `services/` (~**11k** lines remain in `server.js` for boot, host-based HTML, and legacy API blocks). That still creates:

- Painful PR reviews and merge conflicts
- Hard onboarding (“where is this endpoint?”)
- Violation of the repo’s own [incremental refactor policy](../development/README.md#server-js-refactor-policy)

Runtime behavior is fine; the issue is **maintainability**, not correctness.

## Principles

1. **New HTTP handlers** go in [`middleware-platform/routes/`](../../middleware-platform/routes/), mounted from `server.js`.
2. **Business logic** stays in [`services/`](../../middleware-platform/services/) and [`lib/`](../../middleware-platform/lib/).
3. **One route group per PR** when possible; identical URLs and JSON contracts.
4. **Dependency injection** — route modules receive `db`, middleware, and helpers via a `deps` object (see [`routes/patient-care-program-billing.js`](../../middleware-platform/routes/patient-care-program-billing.js)).

## Layering

```text
server.js          → boot, CORS, static mounts, register*Routes(app, deps)
routes/*.js        → paths, middleware chain, res.json shape
services/ + lib/   → domain rules, SQL helpers, enrichment
database.js        → persistence primitives
```

## Target layout

| Module | Owns |
|--------|------|
| [`routes/patient-routine.js`](../../middleware-platform/routes/patient-routine.js) | Routine, journal calendar-range, progress-summary, auth handoff |
| [`routes/patient-shelf.js`](../../middleware-platform/routes/patient-shelf.js) | Shelf products + link-routine-item |
| [`routes/patient-products.js`](../../middleware-platform/routes/patient-products.js) | Product catalog, lists, scans |
| [`routes/patient-billing-portal.js`](../../middleware-platform/routes/patient-billing-portal.js) | Inline billing portal APIs (documents, events, money-summary, …) |
| [`routes/patient-care-program-billing.js`](../../middleware-platform/routes/patient-care-program-billing.js) | Stripe care-program subscription (already extracted) |
| [`middleware/patient-session.js`](../../middleware-platform/middleware/patient-session.js) | `requirePatientSession`, `resolvePatientIdFromSession`, portal events |
| [`lib/patient-portal-shared.js`](../../middleware-platform/lib/patient-portal-shared.js) | ISO date helpers, `safeParseJsonArray`, signed doc URLs |
| [`lib/patient-routine-db.js`](../../middleware-platform/lib/patient-routine-db.js) | `ensureRoutineTables` |
| [`services/kelly-triage-turn-service.js`](../../middleware-platform/services/kelly-triage-turn-service.js) | Shared Kelly triage turn (patient portal + landing) |
| [`routes/public-landing-assistant.js`](../../middleware-platform/routes/public-landing-assistant.js) | `/api/public/landing-assistant/*` |
| [`routes/public-product-scan.js`](../../middleware-platform/routes/public-product-scan.js) | `/api/public/beautyfacts`, `/api/public/foodfacts` |
| [`routes/patient-checkout-chat.js`](../../middleware-platform/routes/patient-checkout-chat.js) | Patient + public checkout-chat Kelly turns |
| [`services/patient-checkout-chat-service.js`](../../middleware-platform/services/patient-checkout-chat-service.js) | Commerce checkout-chat orchestration |
| [`routes/patient-profile.js`](../../middleware-platform/routes/patient-profile.js) | Profile, intake, me, features, records, receipts |
| [`routes/patient-auth.js`](../../middleware-platform/routes/patient-auth.js) | OTP verify, logout |
| [`routes/patient-documents.js`](../../middleware-platform/routes/patient-documents.js) | Documents CRUD, upload link, visit feedback |
| [`routes/patient-wallet.js`](../../middleware-platform/routes/patient-wallet.js) | Wallet, HSA, cards |
| [`routes/patient-insurance.js`](../../middleware-platform/routes/patient-insurance.js) | Insurance GET/PUT |
| [`routes/voice-appointments.js`](../../middleware-platform/routes/voice-appointments.js) | Inline `/voice/appointments/*` and related |
| [`routes/admin-platform.js`](../../middleware-platform/routes/admin-platform.js) | Legacy `/api/admin/*` handlers |
| [`lib/resolve-clinic-id.js`](../../middleware-platform/lib/resolve-clinic-id.js) | `resolveClinicIdFromRequest`, `FALLBACK_CLINIC_ID` |
| [`bootstrap/static-hosting.js`](../../middleware-platform/bootstrap/static-hosting.js) | SPA prefixes, dashboard static, CRA assets |

## `patientRouteDeps` contract

Route registrars receive a subset of:

| Key | Role |
|-----|------|
| `apiLimiter` | Rate limit middleware |
| `express` | JSON / urlencoded |
| `db` | Database module |
| `requirePatientSession` | Patient auth |
| `resolvePatientIdFromSession` | FHIR patient id resolution |
| `recordPatientPortalEvent` | Analytics / audit events |
| `ensureRoutineTables` | DDL for routine tables |
| `ensureBillingTables` | DDL for billing tables |
| `parseBillingDocumentUpload` | Multer for photo/billing uploads |
| `fetchBillingAggregatesByDay`, `fieldsFromSqlAggRow` | Journal + billing calendar merge |
| `PatientPortalService` | Handoff exchange validation |
| Shelf helpers | `loadPatientShelfProductRows`, `formatShelfProductApiRow`, … |

## Phase status

| Phase | Scope | Status |
|-------|--------|--------|
| 0 | This doc + ownership map updates | Done |
| 1 | `routes/patient-routine.js` | Done |
| 2 | `routes/patient-shelf.js`, `patient-products.js` | Done |
| 3 | `routes/patient-billing-portal.js` | Done |
| 4 | `middleware/patient-session.js` + shared libs | Done |
| 5 | Kelly booking / triage / appointments (~19k lines) | Done (`routes/patient-booking.js`) |
| 6 | Kelly triage service + landing routes | Done (`services/kelly-triage-turn-service.js`, `routes/public-landing-assistant.js`) |
| 6b | Product scan + checkout-chat | Done (`routes/public-product-scan.js`, `routes/patient-checkout-chat.js`) |
| 6c | Remaining patient portal inline routes | Done (`patient-profile`, `patient-auth`, `patient-documents`, `patient-wallet`, `patient-insurance`) |
| 6d | Voice appointment inline routes | Done (`routes/voice-appointments.js`) |
| 6e | Admin platform inline routes | Done (`routes/admin-platform.js`) |
| 6f | Static hosting bootstrap | Done (`bootstrap/static-hosting.js`; host-based HTML still in `server.js`) |

Triage HTTP handlers in **`routes/patient-booking.js`** call **`services/kelly-triage-turn-service.js`** directly (no `handlePatientTriageMessage` in `server.js`).

## Routine / timeline API index

Owned by **`routes/patient-routine.js`** (was inline in `server.js`):

| Method | Path |
|--------|------|
| POST | `/api/patient/auth/handoff/create` |
| POST | `/api/patient/auth/handoff/exchange` |
| GET/POST | `/api/patient/routine/template` |
| GET | `/api/patient/routine/phase` |
| GET | `/api/patient/routine/compare` |
| GET | `/api/patient/routine/layering-check` |
| GET/POST | `/api/patient/routine/daily` |
| POST | `/api/patient/routine/daily/:id/media-link` |
| POST | `/api/patient/routine/daily/:id/photo` |
| GET | `/api/patient/journal/calendar-range` |
| GET | `/api/patient/home/progress-summary` |

Product contracts: [`docs/architecture/patients/PATIENT_TIMELINE_ROUTINE_AND_BILLING.md`](./patients/PATIENT_TIMELINE_ROUTINE_AND_BILLING.md), parity: [`docs/user-journey/06-mobile-and-web-parity.md`](../user-journey/06-mobile-and-web-parity.md).

## How to add a new patient endpoint

1. Pick the owning `routes/patient-*.js` file (or create one).
2. Add handler inside `register*Routes(app, deps)` — **not** inline in `server.js` unless hotfix.
3. Put non-trivial logic in `lib/` or `services/`.
4. Add/update Jest coverage for contracts.
5. Update this file’s ownership table and [`RUNTIME_ENTRYPOINTS_AND_ROUTE_OWNERSHIP.md`](./RUNTIME_ENTRYPOINTS_AND_ROUTE_OWNERSHIP.md).

## Verification

```bash
cd middleware-platform
npm test -- --testPathPattern="routine|compare|layering|calendar"
node scripts/sandbox-routine-photo-loop.cjs
node -e "require('./server.js')"  # or start server and smoke Today/Journal
```

`wc -l server.js` should decrease after each extraction phase.
