# Runtime entrypoints and route ownership (middleware)

**Last Updated:** 2026-05-21

Single map for “what listens where” on the main Node process. **Compose entry:** [`middleware-platform/server.js`](../../middleware-platform/server.js). **Decomposition map:** [`SERVER_DECOMPOSITION.md`](./SERVER_DECOMPOSITION.md).

## Patient portal routes (extracted from server.js)

| Module | Paths |
|--------|--------|
| [`routes/patient-routine.js`](../../middleware-platform/routes/patient-routine.js) | `/api/patient/routine/*`, `/api/patient/journal/calendar-range`, `/api/patient/home/progress-summary`, auth handoff |
| [`routes/patient-shelf.js`](../../middleware-platform/routes/patient-shelf.js) | `/api/patient/shelf/products` |
| [`routes/patient-products.js`](../../middleware-platform/routes/patient-products.js) | `/api/patient/products/*` |
| [`routes/patient-billing-portal.js`](../../middleware-platform/routes/patient-billing-portal.js) | `/api/patient/billing/*` (portal; not care-program Stripe) |
| [`routes/patient-care-program-billing.js`](../../middleware-platform/routes/patient-care-program-billing.js) | `/api/patient/billing/care-program/*` |
| [`routes/patient-booking.js`](../../middleware-platform/routes/patient-booking.js) | Appointments, booking, triage/message, async-review |
| [`services/kelly-triage-turn-service.js`](../../middleware-platform/services/kelly-triage-turn-service.js) | Kelly triage turn logic (portal + landing) |
| [`routes/public-landing-assistant.js`](../../middleware-platform/routes/public-landing-assistant.js) | Landing assistant turn, TTS, results, thread-event, voice metrics |
| [`routes/public-product-scan.js`](../../middleware-platform/routes/public-product-scan.js) | `beautyfacts` / `foodfacts` barcode lookup |
| [`routes/patient-checkout-chat.js`](../../middleware-platform/routes/patient-checkout-chat.js) | Checkout-chat turns (patient + public) |
| [`routes/patient-profile.js`](../../middleware-platform/routes/patient-profile.js) | Profile, intake, identity, records |
| [`routes/patient-auth.js`](../../middleware-platform/routes/patient-auth.js) | Verify OTP, logout |
| [`routes/patient-documents.js`](../../middleware-platform/routes/patient-documents.js) | Documents, upload link |
| [`routes/patient-wallet.js`](../../middleware-platform/routes/patient-wallet.js) | Wallet, cards |
| [`routes/patient-insurance.js`](../../middleware-platform/routes/patient-insurance.js) | Insurance |
| [`routes/voice-appointments.js`](../../middleware-platform/routes/voice-appointments.js) | Voice scheduling/checkout/insurance HTTP |
| [`routes/admin-platform.js`](../../middleware-platform/routes/admin-platform.js) | Inline admin dashboard API |
| [`middleware/patient-session.js`](../../middleware-platform/middleware/patient-session.js) | Shared `requirePatientSession`, CSRF, portal events |

## Process

- **Entry:** `node server.js` from [`middleware-platform/package.json`](../../middleware-platform/package.json).
- **Default port:** `4000` (or `PORT`).

## Patient Navigator & Skin & Care SPA (HTML)

The Skin & Care marketing CRA bundle (`unified-dashboard/littlelab-landing/build`) is served for:

| Pattern | Notes |
|---------|--------|
| `GET /` | Host-based routing (local dev hosts serve SPA via `sendLittleLabOrApiRunningStub` / `trySendCanonicalLanding`). |
| `GET /find-provider`, `GET /find-provider/*` | `app.use('/find-provider', serveLittleLabSpaGetHead)` — Patient Navigator Medicaid provider page. |
| `GET /shop`, `GET /shop/*` | Same SPA shell for Skin & Care marketing (`Root`). |
| `GET /how-it-works` | Legacy; serves same SPA stub as above. |
| `/static`, `/images`, `/videos` | CRA assets. |

Client-side routing (hash and paths) lives in [`unified-dashboard/littlelab-landing/src/index.js`](../../unified-dashboard/littlelab-landing/src/index.js). Plan/results UX uses **`/?view=results`** or **`/results`** (pathname), not **`/results/:sessionId`** as a client route. Session snapshots are loaded via **`GET /api/public/landing-assistant/results/:sessionId`**.

## Static dashboards

SPA static mounts (`/unified-dashboard`, `/patients`, `/business`, `/insurer`, `/littlelab-landing`, CRA assets) are registered via [`bootstrap/static-hosting.js`](../../middleware-platform/bootstrap/static-hosting.js) from `server.js`. Host-based HTML routes for `/`, `/shop`, `/find-provider` remain in `server.js`.

## Public catalog / consumer APIs (representative)

| Prefix | Router / area |
|--------|----------------|
| `/api/public/plans` | `routes/public-plan-search.js` |
| `/api/public/geo` | `routes/public-geo.js` |
| `/api/public/providers` | `routes/public-provider-search.js` |
| `/api/public/products`, `/public/products` | `routes/public-products.js` |
| `/api/public/commerce`, `/public/commerce` | commerce quote + cart routes |
| `/api/public/checkout`, `/api/public/checkout-chat` | public checkout surfaces |

## Landing assistant (Kelly HTTP)

| Method | Path |
|--------|------|
| `POST` | `/api/public/landing-assistant/turn` |
| `GET` | `/api/public/landing-assistant/results/:sessionId` |
| `POST` | `/api/public/landing-assistant/thread-event` |
| `POST` | `/api/public/landing-assistant/tts-stream` |

## Deeper reference

- Middleware narratives and checklists: [`docs/middleware-platform/README.md`](../middleware-platform/README.md).
- Canonical topic index: [`docs/meta/CANONICAL_DOC_MAP.md`](../meta/CANONICAL_DOC_MAP.md).
