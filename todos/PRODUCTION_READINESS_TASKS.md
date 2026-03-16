# Production Readiness: Tasks & Azure Setup

**Purpose:** Single checklist of tasks to make the DocLittle platform production-ready for real patients (book → pay → join telemedicine). Includes Azure setup and compliance.

**Related:** [ARCHITECTURE_OVERVIEW_AND_COLAB_RAG.md](../docs/architecture/ARCHITECTURE_OVERVIEW_AND_COLAB_RAG.md), [MASTER_TODO_FULL.md](../docs/development/MASTER_TODO_FULL.md), [VIDEO_CONSULT.md](../docs/architecture/VIDEO_CONSULT.md), [DEPLOYMENT_GUIDE.md](../docs/deployment/guides/DEPLOYMENT_GUIDE.md).

---

## 0. Already Implemented (Verify Only)

These exist in the codebase; confirm they are enabled and correctly configured in production:

| Area | What exists | Verify |
|------|-------------|--------|
| **Admin sessions** | `admin_sessions` table; `database.createAdminSession` / `getAdminSession`; `admin-auth.js` uses DB | Cookie name `admin_session`; session persists across restarts |
| **visit_pricing** | Table `visit_pricing` (clinic_id, appointment_type, base_price, surge_multiplier); seeding in DB | Checkout uses it (no remaining hardcoded amount); GET /api/pricing used |
| **HIPAA table** | `hipaa_access_log` table; `database.logHipaaAccess()` | All PHI access routes call `logHipaaAccess` (see S4) |
| **Rate limiting** | `middleware/rate-limiter.js` (API, auth, voice, schedule/checkout, payment); `clinic-rate-limiter.js` | Applied to `/voice/*`, auth, payment routes; tune limits if needed |
| **Webhook verification** | Stripe (signature), Circle (X-Circle-Signature); Retell middleware in `routes/retell-functions.js` | Stripe/Circle/Retell secrets set; verification not skipped in prod |
| **Cookie security** | Admin cookies: `httpOnly`, `sameSite: 'strict'`, `secure` when HTTPS | In production, `secure: true` is used when HTTPS detected |
| **CORS** | `cors` middleware with config in `server.js` | Production origin allowlist (no wildcard `*` for credentials) |
| **Deploy prompts** | `deploy-to-azure.sh` copies `docs/voice-agent/` into package | Prompts present on Azure after deploy |

---

## 1. Azure Setup (Infrastructure)

### 1.1 App Service & Code Deploy

| # | Task | Status / Notes |
|---|------|----------------|
| A1 | Deploy app to Azure App Service | Use `./scripts/deploy-to-azure.sh`; app name `doclittle`, resource group `doclittle` |
| A2 | Configure root domain | Run `./scripts/add-root-domain.sh` or add `doclittle.site` in Azure Portal |
| A3 | DNS (IONOS or registrar) | A record for `doclittle.site` → Azure App Service outbound IP or ALIAS to `doclittle.azurewebsites.net` |
| A4 | SSL for root domain | `az webapp config ssl create` then `ssl bind` for `doclittle.site` (see [QUICK_DEPLOYMENT_GUIDE.md](../docs/deployment/guides/basic/QUICK_DEPLOYMENT_GUIDE.md)) |
| A5 | Tenant subdomains SSL | Azure managed certs = root only. Use [SUBDOMAIN_SSL_FIX.md](../docs/deployment/dns/SUBDOMAIN_SSL_FIX.md): Cloudflare (recommended) or wildcard cert |

### 1.2 Azure Domain Service (Tenant Subdomains)

| # | Task | Status / Notes |
|---|------|----------------|
| A6 | Azure CLI available in deploy/CI | `AzureDomainService.setupTenantDomain()` uses `az` for custom domain + SSL |
| A7 | Env for domain setup | `AZURE_APP_NAME`, `AZURE_RESOURCE_GROUP`, `AZURE_ROOT_DOMAIN`; optional `AZURE_SKIP_SSL=true` in dev |
| A8 | New tenant flow | On signup call `AzureDomainService.setupTenantDomain(tenantSubdomain)`; ensure DNS for `*.doclittle.site` (e.g. CNAME to app) |

### 1.3 Azure Communication Services (Email)

| # | Task | Status / Notes |
|---|------|----------------|
| A9 | Create Communication Services + Email Service | See [docs/azure/README.md](../docs/azure/README.md): `doclittle-communication`, `doclittle-email`, `doclittle-rg` |
| A10 | Verify domain & sender | Add MX/TXT/CNAME in IONOS; verify `doclittle.site` and `DoNotReply@doclittle.site` |
| A11 | App settings | `AZURE_COMMUNICATION_CONNECTION_STRING`, `AZURE_EMAIL_SENDER=DoNotReply@doclittle.site` |

### 1.4 Database (Production)

| # | Task | Status / Notes |
|---|------|----------------|
| A12 | Prefer Postgres in production | Bicep: `infra/bicep/app-service-with-postgres.bicep`; set `POSTGRES_URL` in App Service |
| A13 | Migrations | Add versioned migrations (e.g. `migrations` table); avoid schema drift from ad-hoc CREATE TABLE |
| A14 | Backup & restore | Configure Azure DB backups; document RTO/RPO |

---

## 2. Security & Compliance (HIPAA-Ready)

### 2.1 Auth & Sessions

| # | Task | Status / Notes |
|---|------|----------------|
| S1 | DB-backed admin sessions | Verify admin auth uses `admin_sessions` table (implemented in `database.js` + `admin-auth.js`); sessions persist across restarts |
| S2 | API key encryption | `API_KEY_ENCRYPTION_KEY` required in production (`utils/api-keys.js`) |
| S3 | Provider auth | Implement `provider_sessions` + middleware; scope dashboard by `practitioner_id` |

### 2.2 PHI & Audit

| # | Task | Status / Notes |
|---|------|----------------|
| S4 | HIPAA access logging | Populate `hipaa_access_log` for patient/FHIR access, payment events; 7-year retention (see [DATA_RETENTION_POLICY.md](../docs/compliance/DATA_RETENTION_POLICY.md)) |
| S5 | PII redaction | Use `utils/pii-redactor.js`; redact before storage/logging where appropriate |
| S6 | Transcript encryption (P2) | Optional: `TRANSCRIPT_ENCRYPTION_KEY`; encrypt transcript content at rest |
| S7 | BAA acknowledgment | Set `BAA_ACKNOWLEDGED=true` when BHAs in place (LiveKit, Deepgram/OpenAI, etc.); see [VIDEO_CONSULT.md](../docs/architecture/VIDEO_CONSULT.md) |

### 2.3 Secrets & Config

| # | Task | Status / Notes |
|---|------|----------------|
| S8 | No secrets in repo | All keys in Azure App Settings / Key Vault (or env); no `.env` in deploy package; add `.env.example` (no secrets) for required var names |
| S9 | Video consult agent auth | Set `VIDEO_CONSULT_AGENT_SECRET`; agents send `X-Video-Consult-Secret` or Bearer |
| S10 | Twilio webhook validation | Validate `X-Twilio-Signature` on `POST /voice/incoming` (Twilio auth token) so only Twilio can trigger calls; not currently implemented |
| S11 | CORS production allowlist | Restrict `corsOptions.origin` to exact production domains (e.g. `https://doclittle.site`, tenant subdomains); no `*` when credentials used |
| S12 | Wire HIPAA log everywhere | Ensure every route that returns or modifies PHI (FHIR, patient, claims, eligibility) calls `db.logHipaaAccess()` with correct resource_type, resource_id, patient_id |

---

## 3. Telemedicine & Video Consult

### 3.1 Join Flow (Patient Can Join Today)

| # | Task | Status / Notes |
|---|------|----------------|
| V1 | LiveKit room creation on match | When appointment matched: create room, issue tokens, store join URL |
| V2 | Patient join link delivery | Email/SMS join link (e.g. `https://.../join?room=...&token=...`) after match/reminder |
| V3 | Join URL API | Endpoint or page that validates token and loads LiveKit Web SDK (or in-app); document in runbook |
| V4 | Provider no-show handling | If provider doesn’t join within X min: mark `provider_no_show`, re-queue patient (see MASTER_TODO P0-4) |

### 3.2 Video Pipeline (Already Documented)

| # | Task | Status / Notes |
|---|------|----------------|
| V5 | Env for video | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`; `VIDEO_CONSULT_AGENT_SECRET`, `VIDEO_CONSULT_MAX_FRAMES_PER_SESSION`, `VIDEO_CONSULT_MAX_COST_PER_SESSION` |
| V6 | Agent-events endpoint | `POST /api/video-consult/agent-events` (transcript, vision_frame, end_session); LangGraph → FHIR (see [VIDEO_CONSULT.md](../docs/architecture/VIDEO_CONSULT.md)) |
| V7 | Optional: Colab case report | If you want "transcribe + labs + images → case report": integrate Colab pipeline output into `fhir_diagnostic_reports` (separate project) |
| V8 | LangGraph multi-instance | For multiple app instances: set `LANGGRAPH_USE_POSTGRES=true` and Postgres checkpointer so video-consult state is shared (see [VIDEO_CONSULT.md](../docs/architecture/VIDEO_CONSULT.md)) |

---

## 4. Voice, Scheduling & Payments

### 4.1 Pricing & Checkout

| # | Task | Status / Notes |
|---|------|----------------|
| P1 | No hardcoded amounts | Ensure all checkout/pricing paths use `visit_pricing` (table exists); remove any remaining hardcoded $39.99 or default amount in code |
| P2 | visit_pricing API | GET /api/pricing (clinic_id, appointment_type); POST /api/admin/pricing; wire `create_appointment_checkout` to it |
| P3 | Set base prices | e.g. $69 general, $109 therapy, $179 psychiatry initial, $99 follow-up; seed or admin UI |
| P3b | surge_enabled on clinics | Add `surge_enabled` boolean to clinics (default false); gate dynamic pricing (MASTER_TODO Phase 0) |

### 4.2 Safety (Voice)

| # | Task | Status / Notes |
|---|------|----------------|
| P4 | Emergency warm transfer | On red-flag: transfer to crisis/triage line; no dead-air (MASTER_TODO P0-1) |
| P5 | Dual-layer urgency | Rule-based keyword failsafe + conservative classifier; block scheduling for EMERGENT |
| P6 | Medical STT | Prefer medical-tuned STT (e.g. Deepgram Nova-2 Medical) or medical lexicon post-process |

### 4.3 Payments

| # | Task | Status / Notes |
|---|------|----------------|
| P7 | Stripe webhook secret | `STRIPE_WEBHOOK_SECRET` in production; verify signature on webhooks |
| P8 | Idempotency | Payment/checkout complete and Stripe Connect transfers idempotent; idempotency keys for claim submission |
| P9 | Visit charge timing | Document when charge occurs (booking vs session start vs post-SOAP); reflect in ledger (MASTER_TODO P0-5) |
| P10 | No-show deposit (optional) | Stripe authorize-only (capture_method: manual); capture on in_session; cancel if cancelled >24h; optional $25 no-show fee (MASTER_TODO Phase 3) |
| P11 | Retell webhook secret | Set and verify Retell webhook secret where used (e.g. function routes); reject unauthenticated requests in production |

---

## 5. Monitoring & Operations

| # | Task | Status / Notes |
|---|------|----------------|
| M1 | Health checks | `/health` and `/api/rag/health`; use in load balancer / availability probes |
| M2 | Structured logging | JSON logs; no raw PHI in logs; use Azure Log Analytics or App Insights |
| M3 | Application Insights (optional) | Enable `@azure/monitor-opentelemetry`; set `APPLICATIONINSIGHTS_CONNECTION_STRING` |
| M4 | Alerts | Critical: API 5xx rate, payment/Stripe failures, RAG/LangGraph failures; optional: DLQ backlog (`DLQ_TOOL_CALLS_ALERT_THRESHOLD`) |
| M5 | Retention & cleanup | Run `scripts/cleanup-retention.js` on schedule; align with [DATA_RETENTION_POLICY.md](../docs/compliance/DATA_RETENTION_POLICY.md) |
| M6 | Video consult cleanup | Run `scripts/cleanup-video-consult-data.js` if using video; respect retention |
| M7 | Feature flags | Feature flags for: new matching vs legacy, new pricing vs hardcode, deposit-hold vs capture; rollback path (MASTER_TODO 67) |
| M8 | E2E test | At least one E2E: voice book → (match) → payment → LiveKit join (or schedule → checkout → confirm) (MASTER_TODO 68) |
| M9 | Dependency scanning | Run `npm audit` (or equivalent); fix critical/high; document policy for PHI/financial services |
| M10 | CI/CD | Verify GitHub Actions (or other) deploy pipeline; no manual-only deploy for production |

---

## 6. Environment Variables (Production)

Set these in **Azure App Service → Configuration → Application settings** (or Key Vault references):

**Required**

- `NODE_ENV=production`
- `PORT=4000`
- `API_BASE_URL` / `BASE_URL` = e.g. `https://doclittle.site`
- `RETELL_API_KEY`, `RETELL_AGENT_ID` (or per-clinic agent)
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `AZURE_COMMUNICATION_CONNECTION_STRING`, `AZURE_EMAIL_SENDER`
- `DEFAULT_CLINIC_ID` or `PRIMARY_CLINIC_ID` (if single-tenant)
- `API_KEY_ENCRYPTION_KEY` (production)

**Optional but recommended**

- `POSTGRES_URL` (production DB)
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `VIDEO_CONSULT_AGENT_SECRET`
- `RAG_API_URL`, `COLAB_RAG_URL` (for RAG proxy)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (calendar)
- `BAA_ACKNOWLEDGED=true` when BAAs signed
- `APPLICATIONINSIGHTS_CONNECTION_STRING` (monitoring)

**Azure domain (for tenant subdomains)**

- `AZURE_APP_NAME`, `AZURE_RESOURCE_GROUP`, `AZURE_ROOT_DOMAIN`

**Optional (insurance / RAG / video)**

- `STEDI_API_KEY`, `STEDI_ENV` (sandbox vs production) if using insurance claims
- `LANGSMITH_API_KEY` or `LANGCHAIN_TRACING_V2` for LangGraph tracing

---

## 7. Quick Azure Setup Order

1. **Subscription & CLI:** `az login`; create/select resource group (e.g. `doclittle`).
2. **App Service:** Deploy with `./scripts/deploy-to-azure.sh` (or GitHub Actions).
3. **Domain:** Add hostname `doclittle.site`; configure DNS; create and bind SSL cert.
4. **Email:** Create Communication Services + Email Service; verify domain and sender; set env vars (see [docs/azure/README.md](../docs/azure/README.md)).
5. **Database:** Deploy Postgres (e.g. Bicep); set `POSTGRES_URL`.
6. **App settings:** Set all required env vars (no secrets in code).
7. **Tenant subdomains:** Configure `*.doclittle.site` (Cloudflare or wildcard); set Azure domain env vars for new tenants.
8. **Monitoring:** Enable App Insights (optional); configure alerts.
9. **Compliance:** Turn on HIPAA logging; set `BAA_ACKNOWLEDGED` when ready; run retention cleanup on schedule.

---

## 8. Summary: "Production Ready" Definition

- **Azure:** App Service live, root + tenant SSL, email via Azure, Postgres (or SQLite for demo only).
- **Security:** DB-backed sessions, API key encryption, HIPAA audit log populated, BAAs acknowledged where needed.
- **Telemedicine:** Patient can receive and use a join link; LiveKit + agent-events + LangGraph → FHIR working; optional case report pipeline.
- **Voice & payments:** Pricing from DB, checkout → payment → confirm; emergency egress and triage safeguards.
- **Operations:** Health checks, logging, retention cleanup, and critical alerts in place.

For full product backlog (matching, providers, PHQ-9, SOAP, etc.), see [MASTER_TODO_FULL.md](../docs/development/MASTER_TODO_FULL.md).

---

## 9. What Was Missing (Review Additions)

This section summarizes gaps identified during review and now reflected above:

- **Section 0:** Clarified what is already implemented (admin_sessions, visit_pricing, HIPAA table, rate limiting, webhook verification, cookies, CORS, deploy prompts) so you only verify rather than re-implement.
- **Security:** Twilio request validation on `/voice/incoming` (S10), CORS production allowlist (S11), wiring `logHipaaAccess` to every PHI route (S12), `.env.example` (S8).
- **Video:** LangGraph Postgres checkpointer for multi-instance (V8).
- **Payments:** Retell webhook secret (P11), no-show deposit option (P10), idempotency for claims (P8), `surge_enabled` on clinics (P3b).
- **Monitoring / Ops:** Feature flags (M7), E2E test (M8), dependency scanning (M9), CI/CD verification (M10).
- **Env:** Optional Stedi and LangSmith vars in Section 6.
