# DocLittle platform architecture (concise)

This document orients new contributors. Deep dives live in `docs/` and `docs/architecture/`.

## Repository layout

| Area | Path | Role |
|------|------|------|
| **Middleware API** | `middleware-platform/` | Express app (`server.js`), SQLite/Postgres, Kelly agent, commerce, voice, webhooks. |
| **Unified dashboard (static)** | `unified-dashboard/` | Patient HTML (e.g. `patients/checkout-chat.html`), landing, assets. Served by middleware static routes or your CDN. |
| **Patient app** | `patient-app/` | Expo/React Native; shares checkout concepts with web. |
| **Root scripts** | `scripts/` | Repo-wide checks (`verify-agentic-checkout.cjs`, performance budgets, etc.). |

## Checkout chat (web)

- **Page shell:** `unified-dashboard/patients/checkout-chat.html` links `checkout-chat.css`, `checkout-phone-e164.js` (browser mirror of `utils/phone-e164.js`), and `checkout-chat.js`.
- **Behavior map:** `docs/architecture/commerce/AGENTIC_CHECKOUT_FILE_MAP.md`.
- **UX notes:** `docs/CHECKOUT_CHAT_UI_NOTES.md`.
- **Static verify (no server):** `node scripts/verify-agentic-checkout.cjs` from repo root.

### Request flow (simplified)

1. Browser loads checkout-chat; `window.API_BASE` defaults to `http://localhost:4000` — must match how you open the page (`localhost` vs `127.0.0.1`) or set `API_BASE` in an init script.
2. **Kelly session** (chat): `kelly_session_id` in localStorage / query; streams to `/api/public/checkout-chat/turn/stream` (or patient variant when signed in).
3. **Cart session** (`session_id`): public commerce cart under merchant; checkout preparation via `POST /api/public/commerce/cart/checkout` with normalized **E.164** phone (`utils/phone-e164.js`).

## `server.js` scale

- Policy for splitting routes: `docs/development/SERVER_JS_REFACTOR_POLICY.md`.
- Do not grow `server.js` for new features without following that policy.

## Security & payments

- **Predeploy:** `docs/PREDEPLOY_SECURITY_CHECKLIST.md`.
- **Incident:** `docs/PAYMENT_DATA_INCIDENT_PLAYBOOK.md`.
- **Gate:** `npm run release:security-gate` in `middleware-platform` (redaction tests + forbidden-data scan).

## Periodic hygiene

- Re-read security checklists when routes/logging change; follow `docs/development/PERIODIC_MAINTENANCE.md` where applicable.

## CI

- GitHub Actions: `.github/workflows/ci.yml` — middleware `npm test`; optional Playwright/Cypress as documented in `CONTRIBUTING.md`.
- **Playwright:** install browsers in CI or locally: `cd middleware-platform && npx playwright install chromium`.
