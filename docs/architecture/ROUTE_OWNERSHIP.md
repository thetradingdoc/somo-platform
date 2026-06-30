# Route ownership — Pre-Phase 3

**Last updated:** 2026-06-25  
**Gate:** Do not start P3 finance until health + B2B rows are stable.

| Mount prefix | Owner module | Status | Notes |
|--------------|--------------|--------|-------|
| `/api/health-session` | `routes/health-session.js` | **KEEP** | Consumer healthcare financial agent spine |
| `/api/video-consult` | `routes/video-consult.js` | **KEEP** | LiveKit transport; health isolation guards |
| `/health-video/` | `bootstrap/health-ui.js` | **KEEP** | React SPA static |
| `/webhooks/stripe` | `routes/stripe-webhook-handler.js` | **KEEP** | P3 copay payment |
| `/webhooks/stedi` | `routes/stedi-webhooks.js` | **KEEP** | P3 eligibility |
| `/api/rcm`, `/api/invoices` | `routes/rcm.js`, invoices | **KEEP** | Claims journey |
| `/voice`, `/api/kelly` | `routes/voice.js`, `kelly.js` | **FREEZE** | B2B Kelly front desk — do not merge health PA |
| `/api/retell` | `routes/retell-functions.js` | **FREEZE** | PSTN functions |
| `webhooks/retell-websocket.js` | retell websocket | **FREEZE** | Split in progress; no health commerce tools |
| `/business/*` | static `business/` | **FREEZE** | Provider HUD frozen |
| `/api/public/commerce` | `public-commerce-*.js` | **DELETE** | Gated `COMMERCE_LEGACY_ENABLED` |
| `/api/public/checkout-chat` | `public-checkout-chat.js` | **DELETE** | Gated off by default |
| `/api/patient/checkout-chat` | `patient-checkout-chat.js` | **DELETE** | Gated off by default |
| `/api/public/landing-assistant` | `public-landing-assistant.js` | **DELETE** | LittleLab retired |
| `/consumer`, `/shop`, `/skin-care` | `server.js` redirects | **DELETE** | Redirect to health or B2B trial |
| `patient-app/` | Expo legacy | **DELETE** | See `patient-app/DEPRECATED.md` |
| `/api/public/funnel-*` | funnel routes | **FREEZE** | Legacy navigator; delete per master plan later |
| `/api/products`, `/api/orders` | commerce catalog | **FREEZE** | Provider merchant — not consumer health |

Full mount list: grep `app.use` in [`middleware-platform/server.js`](../../middleware-platform/server.js) and [`routes/index.js`](../../middleware-platform/routes/index.js).
