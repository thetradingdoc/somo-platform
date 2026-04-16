# Agentic checkout — file map

Cross-surface feature: **landing / deep link → chat (Kelly) → server quote → Stripe pay**.

| Concern | Web | React Native | Middleware |
|--------|-----|--------------|------------|
| UI shell, tokens | `unified-dashboard/patients/checkout-chat.html` | `patient-app/app/checkout-chat.tsx` | — |
| Heroicons / assets | inline SVG + `unified-dashboard/assets/` | `patient-app/components/CheckoutHeroicons.tsx` | — |
| Copy deck (Kelly) | `unified-dashboard/copy/checkout-kelly.json` (+ `DEFAULT_KELLY_COPY` in HTML) | same APIs; tone from Kelly responses | `services/kelly-agent-service.js` prompts |
| Public catalog | fetch `GET /api/public/products` | same | `routes/public-products.js` (via server) |
| Commerce quote | `POST /api/public/commerce/quote` | same | `routes/public-commerce-quote.js` |
| Checkout chat turn | `POST /api/patient/checkout-chat/turn` + `/turn/stream` (SSE) | same | `server.js` handlers → `KellyAgentService` |
| LLM routing | — | — | `services/llm-router.js` (`call`, `callStreamWithDeltas`) |
| Checkout start | `POST /api/public/checkout/start` | same | `routes/public-checkout.js` |
| Analytics | `emitFunnelEvent` / `dataLayer` in HTML | `patient-app/lib/checkoutAnalytics.ts` | — |
| Static verify | — | — | `scripts/verify-agentic-checkout.cjs` (CI) |

**Related docs:** [SKIN_CARE_TOKENS_AND_ASSETS.md](./SKIN_CARE_TOKENS_AND_ASSETS.md), [PUBLIC_AGENTIC_CHECKOUT.md](./PUBLIC_AGENTIC_CHECKOUT.md) (if present), [STAGING_PRODUCT_VERIFICATION.md](../testing/STAGING_PRODUCT_VERIFICATION.md).
