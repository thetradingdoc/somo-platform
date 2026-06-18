# ENV

**Last updated:** 2026-06-02


---

<a id="environment-variables-by-surface"></a>

## ENVIRONMENT VARIABLES BY SURFACE

*Merged from `docs/setup/ENVIRONMENT_VARIABLES_BY_SURFACE.md` on 2026-06-02.*

# Environment variables by surface

> **Last reviewed:** 2026-05-25

Quick reference. Full narrative: [`docs/setup/README.md`](./README.md). Copy from `.env.example` files — never commit real secrets.

## Middleware (`middleware-platform/.env`)

| Group | Keys | Purpose |
|-------|------|---------|
| Database | `DB_PATH`, `SKIP_STARTUP_MIGRATIONS` | SQLite file; skip migrations for scripts/eval |
| Kelly LLM | `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `KELLY_*` | Voice/chat turn loop, models, retries |
| Kelly Phase C | `KELLY_LANG_MIN_CONFIDENCE`, `KELLY_ASR_MIN_CONFIDENCE`, `KELLY_ASR_DEBUG`, `KELLY_RAILS_ES_ENABLED`, `KELLY_OPQRST_ES_PACK` | Language handoff, ASR gate (debug logs metadata keys when `KELLY_ASR_DEBUG=1`), Spanish rails, OPQRST pack — [`todos/PENDING.md`](../../todos/PENDING.md) |
| Voice SLO | `VOICE_SLO_MAX_AVG_WORDS`, `VOICE_SLO_MAX_MULTI_QUESTION_RATE`, `VOICE_SLO_MAX_REPHRASE_RATE`, `VOICE_SLO_MAX_INTERRUPTION_RATE`, `VOICE_SLO_MAX_TTFHR_MS` | Per-session voice quality thresholds |
| Retell | `RETELL_API_KEY`, `RETELL_AGENT_ID`, `RETELL_VOICE_ID`, `RETELL_VOICE_ID_ES`, `RETELL_AGENT_ID_ES` | Phone agent config |
| Voice triage | `REQUIRE_TRIAGE_FOR_VOICE` | Enforce triage before booking tools |
| Medical coding | `SEMANTIC_SEARCH_ENABLED`, `RAG_API_URL`, `PINECONE_*`, `REMOTE_RAG_TIMEOUT_MS`, `EVAL_USE_SEMANTIC` | Code retrieval; prod: `RAG_API_URL=disabled` |
| Stedi / claims | `STEDI_*`, `STEDI_WEBHOOK_SECRET`, `STEDI_CLAIM_SUBMISSION_MODE` | 837P professional claims + webhook |
| Payor ingest | `PAYOR_*`, `NPPES_*` | CMS NPPES pipeline, resolver flags |
| Stripe / Twilio | `STRIPE_*`, `TWILIO_*` | Payments and voice webhooks |
| RCM patient pay | `PUBLIC_PAY_BASE_URL`, `RCM_E2E_STRIPE_LIVE`, `RCM_E2E_USDC_LIVE`, `RCM_PAY_PROBE_CIRCLE_BALANCE`, `CIRCLE_*` | Kelly pay link + Stripe/USDC rails — [RCM_PATIENT_PAY_GATEWAY.md](../RCM/RCM_PATIENT_PAY_GATEWAY.md) |
| Commerce | `PUBLIC_CATALOG_*`, `COMMERCE_*`, `CATALOG_MASTER_SYNC_*` | Public catalog and checkout |
| OpenAI | `OPENAI_API_KEY` | Embeddings (semantic search, Pinecone query embed) |

See also: [Medical Coding OPERATIONS](../Medical%20Coding/OPERATIONS.md), [RENDER_PRODUCTION_CHECKLIST](../deployment/RENDER_PRODUCTION_CHECKLIST.md).

## Somo landing (`unified-dashboard/somo-landing/.env.development`)

| Key | Purpose |
|-----|---------|
| `VITE_API_BASE` | Middleware origin. **Production build:** empty (same-origin) or API host if split later |
| `VITE_SIGNUP_URL` | Provider signup CTA (default `/signup?utm_source=somo`) |
| `VITE_API_PROXY` | Dev-only Vite proxy target (default `http://127.0.0.1:4000`) |

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
| Marketing SPA | `https://callsomo.com` (Firebase Hosting) |
| API | `https://api.callsomo.com` (Cloud Run) |

Details: [`EDGE_ROUTING_CONFIGS.md`](../deployment/EDGE_ROUTING_CONFIGS.md).
