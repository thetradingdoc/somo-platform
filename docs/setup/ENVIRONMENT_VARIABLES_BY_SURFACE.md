# Environment variables by surface

> **Last reviewed:** 2026-05-25

Quick reference. Full narrative: [`docs/setup/README.md`](./README.md). Copy from `.env.example` files — never commit real secrets.

## Middleware (`middleware-platform/.env`)

| Group | Keys | Purpose |
|-------|------|---------|
| Database | `DB_PATH`, `SKIP_STARTUP_MIGRATIONS` | SQLite file; skip migrations for scripts/eval |
| Kelly LLM | `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `KELLY_*` | Voice/chat turn loop, models, retries |
| Retell | `RETELL_API_KEY`, `RETELL_AGENT_ID`, `RETELL_VOICE_ID` | Phone agent config |
| Voice triage | `REQUIRE_TRIAGE_FOR_VOICE` | Enforce triage before booking tools |
| Medical coding | `SEMANTIC_SEARCH_ENABLED`, `RAG_API_URL`, `PINECONE_*`, `REMOTE_RAG_TIMEOUT_MS`, `EVAL_USE_SEMANTIC` | Code retrieval; prod: `RAG_API_URL=disabled` |
| Stedi / claims | `STEDI_*`, `STEDI_WEBHOOK_SECRET`, `STEDI_CLAIM_SUBMISSION_MODE` | 837P professional claims + webhook |
| Payor ingest | `PAYOR_*`, `NPPES_*` | CMS NPPES pipeline, resolver flags |
| Stripe / Twilio | `STRIPE_*`, `TWILIO_*` | Payments and voice webhooks |
| Commerce | `PUBLIC_CATALOG_*`, `COMMERCE_*`, `CATALOG_MASTER_SYNC_*` | Public catalog and checkout |
| OpenAI | `OPENAI_API_KEY` | Embeddings (semantic search, Pinecone query embed) |

See also: [Medical Coding OPERATIONS](../Medical%20Coding/OPERATIONS.md), [RENDER_PRODUCTION_CHECKLIST](../deployment/RENDER_PRODUCTION_CHECKLIST.md).

## Landing CRA (`unified-dashboard/littlelab-landing/.env.local`)

| Key | Purpose |
|-----|---------|
| `REACT_APP_API_BASE` | Middleware origin. **Production build:** `https://api.myskinandcare.com` (or your API host) |
| `REACT_APP_MERCHANT_ID` | Required on non-localhost builds for checkout/catalog |
| `REACT_APP_DEFAULT_CLINIC_ID` | Optional clinic for anonymous assistant |
| `REACT_APP_CHECKOUT_MAINTENANCE_MODE` | Hide checkout entry points when `1` |

## Patient app (`patient-app/.env`)

| Key | Purpose |
|-----|---------|
| `EXPO_PUBLIC_API_BASE_URL` | Middleware API (hosted demo or local/ngrok) |
| `EXPO_PUBLIC_DEMO_PATIENT_EMAIL` | Optional login pre-fill for dev |
| `EXPO_PUBLIC_MERCHANT_ID` | Checkout chat merchant |

## Playwright / CI

| Key | Purpose |
|-----|---------|
| `UI_BASE_URL` | Landing static server (CI: `http://127.0.0.1:5199`) |
| `MIDDLEWARE_API_BASE` | API for E2E (CI: `http://127.0.0.1:4000`) |
| `PW_LANDING_PORT` | Override landing test port (default 5199) |
| `HEADED` | `1` for headed browser runs |

## Production split-domain (reference)

| Surface | Host |
|---------|------|
| Marketing SPA | `https://myskinandcare.com` (Firebase Hosting) |
| API | `https://api.myskinandcare.com` (Cloud Run) |

Details: [`EDGE_ROUTING_CONFIGS.md`](../deployment/EDGE_ROUTING_CONFIGS.md).
