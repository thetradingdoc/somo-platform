# Somo — Healthcare Platform
> Last reviewed: 2026-07-02

**Version**: 3.2.0  
**Status**: NYC B2B front desk pilot (primary) + consumer health session — see [`docs/meta/CANONICAL_DOC_MAP.md`](docs/meta/CANONICAL_DOC_MAP.md)  
**Last Updated:** 2026-07-02

> **Repository:** `git clone https://github.com/richiejeremiah/somo-platform.git` (local folder name `somo` is fine). Production hosts: **callsomo.com** (UI) and **api.callsomo.com** (API) — see [`docs/deployment/FRONT_DESK_PRODUCTION.md`](docs/deployment/FRONT_DESK_PRODUCTION.md).

> **Front-desk master plan (active pilot):** `~/.cursor/plans/provider_portal_production_20d1693f.plan.md`  
> **Front-desk architecture:** [`docs/architecture/LIVE.md`](docs/architecture/LIVE.md) · [`docs/voice-agent/README.md`](docs/voice-agent/README.md)

> **Consumer health plan:** `~/.cursor/plans/somo_health_session_architecture_723cc4d3.plan.md`  
> **Consumer architecture:** [`docs/architecture/HEALTH_SESSION_ARCHITECTURE.md`](docs/architecture/HEALTH_SESSION_ARCHITECTURE.md)

> **Trading agent (separate repo):** [richiejeremiah/trading-agent](https://github.com/richiejeremiah/trading-agent) — biotech paper trading; not maintained in this repository.

> **Documentation**: Full docs live in [`docs/`](./docs/README.md) — that is the **source of truth** for all platform documentation.

> **Contributing**: See **[`CONTRIBUTING.md`](./CONTRIBUTING.md)** for the PR checklist and commands aligned with CI.

> **Architecture notes:** [Health session architecture](docs/architecture/HEALTH_SESSION_ARCHITECTURE.md) · [Route ownership](docs/architecture/LIVE.md#route-ownership-pre-phase-3) · [`server.js` policy](docs/development/README.md#server-js-refactor-policy)

---

## Overview

**Somo** is a healthcare platform with two active product lines:

| Product line | User | Entry | Kelly persona |
|--------------|------|-------|---------------|
| **Somo front desk** (B2B pilot) | Dental / medical practice | `/business/trial-activation.html` → `invite.html` → `voice-setup.html` | **Kelly front desk** — receptionist, scheduling, copay |
| **Somo Health** (consumer) | Anonymous patient | `/health-video/` (`LOCAL_DEV_ROOT=health`) | **Kelly PA** — education only, no diagnosis |
| **Somo pay** (RCM) | Provider | `business/*.html` | Billing, eligibility, claims |

### Front desk — quick start

```bash
cd middleware-platform
npm run verify:unblocked-phases   # structural gates
npm run deploy:callsomo           # from repo root — API + Firebase UI
```

Docs: [`docs/voice-agent/unblocked-phases-ops.md`](docs/voice-agent/unblocked-phases-ops.md) · [`docs/deployment/FRONT_DESK_PRODUCTION.md`](docs/deployment/FRONT_DESK_PRODUCTION.md)

### Consumer health — quick start

```bash
# Local dev — consumer health at http://localhost:4000/health-video/
./run
# or: cd middleware-platform && npm run health:dev
```

### Consumer health — quick features

- Safe VideoGPT for Healthcare: terms → call → chat → structured report
- Groq tool-loop agent (`kelly-pa-video-orchestrator.js`) — not LangGraph on `health-*`
- LiveKit video + browser STT; derm education RAG optional
- Session-scoped auth, DB transcript SSOT, HIPAA audit hooks

---

## B2B / provider platform

**Somo front desk** is the agentic AI receptionist for healthcare practices on **callsomo.com** — inbound PSTN, appointment booking, trial demo. **Somo pay** runs eligibility (Stedi), claims, Stripe, and Circle USDC payouts.

### B2B key features

- ✅ **Voice Agent Integration**: Natural language appointment booking via Retell AI
- ✅ **Appointment Management**: Scheduling, confirmation, cancellation, rescheduling
- ✅ **Payment Processing**: Stripe integration with email verification flow
- ✅ **Insurance Integration**: Stedi API for eligibility checks and claim submission
- ✅ **Patient Records**: FHIR R4 compliant patient data management
- ✅ **Calendar Sync**: Google Calendar integration
- ✅ **Medical Coding**: PDF-based medical coding with ICD-10 and CPT code extraction
- ✅ **Circle Payments**: USDC payment processing for insurance claims
- ✅ **EHR Integration**: Epic and 1upHealth integration for clinical data
- ✅ **Admin Dashboard**: Real-time monitoring and management
- ✅ **Patient Portal**: Self-service appointment management

---

## 🏗️ Architecture

### Technology Stack

**Backend**:
- Node.js (v20+), Express.js
- SQLite (better-sqlite3) with automatic migrations
- Retell AI (voice agent)
- Stripe (payments)
- Circle (USDC payments)
- Stedi API (insurance X12 EDI)
- Google Calendar API
- Groq (medical coding AI)
- Epic/1upHealth (EHR integration)

**Frontend**:
- Static dashboards (provider, admin, business portals)
- Marketing root redirects to `/business/trial-activation.html` (somo-landing SPA retired 2026-06)
- Deploy/hosting: see **[docs/deployment/README.md](docs/deployment/README.md)** (GCP is the documented source of truth)

**Standards**:
- FHIR R4 (healthcare data)
- X12 EDI (insurance transactions)
- HIPAA-compliant data handling

### Project Structure

```
somo/
├── middleware-platform/     # Backend API (Express, Stripe, Retell, voice LLM, FHIR, …)
├── unified-dashboard/       # Provider/patient HTML dashboards + static assets
│   └── _archive/littlelab-landing/  # Retired CRA landing + assistant (2026-05-29)
├── patient-app/             # Expo (React Native) patient app
├── livekit-agents/          # Python transcription / agent workers
├── docs/                    # Canonical documentation (start at docs/README.md)
├── todos/                   # Open work SSOT: todos/PENDING.md
└── README.md                # This file
```

**Agentic commerce (legacy — gated off by default):** see [`docs/architecture/LIVE.md`](docs/architecture/LIVE.md#route-ownership-pre-phase-3). Set `COMMERCE_LEGACY_ENABLED=true` only to revive checkout paths. Legacy `patient-app/` and archived LittleLab are **not** health-finance SSOT.

---

## 🚀 Quick Start

### Prerequisites

- Node.js **v20+** recommended for local development. GitHub Actions also runs CI on **Node 18.x**; use the same checks before pushing if you develop on 18.
- npm v8+
- SQLite (included with better-sqlite3)

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd somo
```

2. **Install backend dependencies**
```bash
cd middleware-platform
npm install
```

3. **Configure environment variables**
```bash
cp .env.example .env
# Edit .env with your API keys
```

4. **Start the backend server**
```bash
npm start
# Server runs on http://localhost:4000
```

5. **Start the frontend (optional, for local development)**
```bash
cd unified-dashboard
python3 -m http.server 8000
# Frontend runs on http://localhost:8000
```

### Local domain routing (mirrors production)

With `middleware-platform` running (`npm start`), visit:

| Surface                      | Local URL                       | Served From                              |
|------------------------------|---------------------------------|------------------------------------------|
| Marketing / trial entry      | http://localhost:4000/          | Redirect → `/business/trial-activation.html` |
| Consumer navigation (PSTN)   | +13639990205                    | `consumer-navigation-handler` when `NAVIGATION_ENABLED=1` |
| Admin landing                | http://localhost:4000/admin     | `unified-dashboard/admin/index.html`     |
| Clinic provider portal (home) | http://localhost:4000/business/today.html | `unified-dashboard/business` |
| API & signup flow            | http://localhost:4000/signup    | `middleware-platform/public/signup` + APIs |

Production hosts: `callsomo.com` (UI), `api.callsomo.com` (API). See [`docs/deployment/FRONT_DESK_PRODUCTION.md`](docs/deployment/FRONT_DESK_PRODUCTION.md).

> The `/admin` route now provides a lightweight launcher linking to the clinic, insurer, and patient portals plus the API hub.

---

## 🔧 Environment Variables

### Required Variables

```bash
# Server
PORT=4000
NODE_ENV=production
POSTGRES_URL=postgresql://user:password@host:5432/middleware?sslmode=require

# Retell AI
RETELL_API_KEY=your_retell_api_key
RETELL_AGENT_ID=your_agent_id
RETELL_SALES_AGENT_ID=your_sales_agent_id  # Optional: Dedicated agent for sales calls (or use RETELL_AGENT_ID)

# Twilio (for outbound calls)
TWILIO_PHONE_NUMBER=+1234567890  # Your Twilio number in E.164 format (e.g., +15551234567)

# Multi-tenant defaults / database
POSTGRES_URL=postgresql://user:password@host:5432/middleware?sslmode=require
DEFAULT_CLINIC_ID=clinic-default

# Stripe
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key

# Stedi Insurance
STEDI_API_KEY=your_stedi_api_key
STEDI_API_BASE=https://api.stedi.com

# Circle Payments (optional)
CIRCLE_API_KEY=your_circle_api_key
CIRCLE_ENTITY_SECRET=your_entity_secret
```

### Optional Variables

```bash
# Google Calendar
GOOGLE_CALENDAR_ID=your_calendar_id
GOOGLE_CLIENT_EMAIL=your_service_account_email
GOOGLE_PRIVATE_KEY=your_private_key

# Email (SMTP on GCP — Gmail, SendGrid, Workspace, etc.)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email
SMTP_PASSWORD=your_password
SMTP_FROM=richard@callsomo.com

# Twilio (SMS)
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token

# Groq (Medical Coding)
GROQ_API_KEY=your_groq_api_key

# Epic EHR
EPIC_CLIENT_ID=your_epic_client_id
EPIC_REDIRECT_URI=your_redirect_uri

# Base URL (for production)
API_BASE_URL=https://api.callsomo.com
BASE_URL=https://api.callsomo.com
# Note: API_BASE_URL takes priority over BASE_URL
# For local development, these can be omitted (defaults to localhost)

# Mastercard Agent Pay (optional)
MASTERCARD_API_KEY=your_mastercard_api_key
MASTERCARD_API_SECRET=your_mastercard_api_secret
MASTERCARD_MERCHANT_ID=your_merchant_id

# Visa Agent Toolkit (optional)
VISA_API_KEY=your_visa_api_key
VISA_API_SECRET=your_visa_api_secret
VISA_MERCHANT_ID=your_merchant_id

# Circle Webhook (optional)
CIRCLE_WEBHOOK_SECRET=your_circle_webhook_secret

# Developer safety toggles
# Set to true only when you intentionally need to bypass the default guardrails
ALLOW_LIVE_KEYS_IN_DEV=false   # Allow live Stripe keys in dev (defaults to blocked)
ALLOW_TEST_EMAIL_BYPASS=false  # Allow signup bypass for test/integration emails

# Job search provider (optional, for agent clinic outreach)
# Option 1: JSearch API (RapidAPI) - Recommended for richer job feeds
JOB_SEARCH_API_URL=https://jsearch.p.rapidapi.com/search
JOB_SEARCH_API_KEY=your_rapidapi_key  # Your X-RapidAPI-Key from RapidAPI
JOB_SEARCH_ENGINE=jsearch

# Option 2: SerpAPI Google Jobs endpoint (alternative)
# JOB_SEARCH_API_URL=https://serpapi.com/search.json
# JOB_SEARCH_API_KEY=your_serpapi_key
# JOB_SEARCH_ENGINE=google_jobs

# Medical receptionist automation (daily Azure job)
ADMIN_PORTAL_BASE_URL=https://callsomo.com       # optional override
MEDICAL_RECEPTIONIST_LOCATION=US,NY               # defaults to US,NY
MEDICAL_RECEPTIONIST_DAYS=1                       # defaults to 1 (today)
MEDICAL_RECEPTIONIST_MAX_LEADS=3                  # how many leads to save per run
INTERNAL_JOB_TOKEN=super-secure-cron-token        # optional bypass for rate limiter
```

---

## 📡 API Endpoints

### Voice Agent Endpoints

**Appointment Booking**:
- `POST /voice/appointments/schedule` - Schedule appointment
- `POST /voice/appointments/confirm` - Confirm appointment
- `POST /voice/appointments/cancel` - Cancel appointment
- `POST /voice/appointments/reschedule` - Reschedule appointment
- `POST /voice/appointments/available-slots` - Get available time slots
- `POST /voice/appointments/search` - Search appointments

**Insurance**:
- `POST /voice/insurance/collect` - Collect insurance information
- `POST /voice/insurance/check-eligibility` - Check insurance eligibility
- `POST /voice/insurance/submit-claim` - Submit insurance claim

**Payment**:
- `POST /voice/appointments/checkout` - Create appointment checkout
- `POST /voice/checkout/verify` - Verify email code
- `POST /process-payment` - Process Stripe payment

### Admin Endpoints

**Appointments**:
- `GET /api/admin/appointments` - Get all appointments
- `GET /api/admin/appointments/upcoming` - Get upcoming appointments

**Insurance & Billing**:
- `GET /api/admin/insurance/claims` - Get insurance claims
- `GET /api/admin/insurance/payers` - Get payers (cached)
- `POST /api/admin/insurance/sync-payers` - Sync payer list from Stedi
- `GET /api/admin/patients/:id/insurance` - Get patient insurance
- `GET /api/admin/patients/:id/eligibility` - Get eligibility checks

**Medical Coding**:
- `POST /api/claims/create-from-pdf` - Create claim from PDF coding
- `GET /api/claims/:id` - Get claim details

**Circle Payments**:
- `POST /api/claims/:claimId/submit-payment` - Submit claim for payment
- `POST /api/claims/:claimId/approve-payment` - Approve and pay claim

### Provider Endpoints

- `GET /api/provider/today` - Get today's schedule
- `GET /api/provider/next-patient` - Get next patient up
- `GET /api/provider/live-stats` - Get real-time statistics

### Patient Portal Endpoints

- `POST /api/patient/verify/send` - Send verification code
- `POST /api/patient/verify/confirm` - Verify code and create session
- `GET /api/patient/appointments` - Get patient's appointments
- `PUT /api/patient/appointments/:id/reschedule` - Reschedule appointment
- `DELETE /api/patient/appointments/:id` - Cancel appointment

---

## 💾 Database

### Database Migrations

The system automatically migrates the database schema on startup. The `database.js` file includes migration logic that:
- Adds missing columns to existing tables
- Creates new tables if they don't exist
- Maintains data integrity

### Key Tables

**Core Tables**:
- `appointments` - Appointment records
- `fhir_patients` - FHIR R4 patient records
- `fhir_encounters` - Healthcare encounters
- `insurance_claims` - Insurance claims with payment tracking
- `eligibility_checks` - Insurance eligibility results
- `patient_insurance` - Patient insurance information
- `circle_transfers` - Circle payment transfers
- `voice_checkouts` - Payment checkout records

**Insurance Tables**:
- `insurance_payers` - Cached payer list (cost optimization)
- `patient_insurance` - Patient insurance records
- `eligibility_checks` - Eligibility verification results
- `insurance_claims` - Submitted claims with payment status

**EHR Tables**:
- `ehr_connections` - EHR OAuth connections
- `ehr_encounters` - Synced EHR encounters
- `ehr_conditions` - ICD-10 diagnosis codes
- `ehr_procedures` - CPT procedure codes

---

## 🔄 Workflow

### Complete Call Flow

1. **Patient Calls** → Retell AI voice agent answers
2. **Information Collection** → Name, phone, email, insurance
3. **Appointment Booking** → Agent schedules appointment
4. **Insurance Verification** → Checks eligibility via Stedi
5. **Payment Processing** → Creates checkout, verifies email, processes payment
6. **Confirmation** → Sends confirmation email with calendar link
7. **Post-Appointment** → EHR sync pulls clinical data (ICD-10, CPT codes)
8. **Claim Submission** → Auto-submits insurance claim with codes
9. **Payment Processing** → Circle payments for approved claims

### Medical Coding Flow

1. **PDF Upload** → Provider uploads medical document
2. **Text Extraction** → System extracts text from PDF
3. **AI Coding** → Groq AI extracts ICD-10 and CPT codes
4. **Code Validation** → Validates codes against knowledge base
5. **Claim Creation** → Creates insurance claim with codes
6. **Patient Selection** → Links claim to patient
7. **Submission** → Submits claim to insurance via Stedi

---

## 🧪 Testing

```bash
cd middleware-platform
npm test    # Jest (see package.json for focused suites)
```

Playwright (landing + prod smoke): see **[docs/testing/README.md](docs/testing/README.md)** and **`middleware-platform/package.json`** scripts (`test:e2e-landing`, `test:prod:smoke`, etc.).

---

## 🚢 Deployment

**Canonical:** **[docs/deployment/README.md](docs/deployment/README.md)** — GCP workflows, gates, and rollback ([docs/runbooks/README.md](docs/runbooks/README.md)).

Scheduled prod monitors: **[docs/runbooks/README.md](docs/runbooks/README.md)**.

Legacy `netlify.toml` / `railway.json` files may still exist for historical reference; do not treat them as the primary deploy path unless an active runbook says otherwise.

---

## 🔒 Security & Compliance

### HIPAA Compliance

- FHIR R4 compliant patient records
- PHI masking in UI
- Secure API endpoints (HTTPS)
- Audit logging for all data access
- Encrypted database connections (production)

### Data Security

- ✅ **Rate Limiting**: Protects against DDoS and abuse
  - General API: 100 requests/15min per IP
  - Authentication: 5 attempts/15min per IP
  - Payment: 10 requests/hour per IP
  - Voice: 20 requests/minute per IP
- ✅ **Security Headers**: Helmet.js integration (CSP, XSS protection)
- ✅ **Input Sanitization**: Automatic sanitization of all inputs
- ✅ **Request Logging**: Structured logging for all requests
- ✅ **Webhook Verification**: Circle webhook signature verification
- ✅ **API Authentication**: API key support (optional)
- Database encryption at rest
- SQL injection prevention (prepared statements)
- CORS configuration

---

## 🐛 Troubleshooting

### Common Issues

**Database Migration Errors**:
- Solution: Database migrations run automatically on startup
- If issues persist, check `database.js` migration logic

**Missing API Keys**:
- Solution: Ensure all required environment variables are set
- Check `.env` file or Railway/Netlify environment variables

**Insurance Claims Error**:
- Solution: Database migration automatically adds missing columns
- Restart server to apply migrations

**Payment Processing Errors**:
- Solution: Verify Stripe API keys are correct
- Check Circle API configuration for USDC payments


---

## 📚 Key Services

### Booking Service
- Handles appointment scheduling, availability checks, conflict resolution
- Location: `middleware-platform/services/booking-service.js`

### Insurance Service
- Stedi API integration for eligibility checks and claim submission
- Location: `middleware-platform/services/insurance-service.js`

### Medical Coding Service
- Groq AI integration for ICD-10 and CPT code extraction
- Location: `middleware-platform/services/medical-coding-service.js`

### Circle Service
- USDC payment processing for insurance claims
- Location: `middleware-platform/services/circle-service.js`

### EHR Sync Service
- Epic and 1upHealth integration for clinical data
- Location: `middleware-platform/services/ehr-sync-service.js`

---

## 💰 Circle Wallet Setup

### Wallet Configuration

The system uses Circle for USDC payment processing. To set up wallets:

1. **Create System Wallet**:
```bash
cd middleware-platform
node scripts/setup-circle-system-wallet.js
```

2. **Configure Environment Variables**:
```env
CIRCLE_WALLET_SET_ID=your_wallet_set_id
CIRCLE_SYSTEM_WALLET_ID=your_system_wallet_id
CIRCLE_ENTITY_SECRET=your_entity_secret
```

3. **Fund System Wallet**:
   - Go to [Circle Console](https://console.circle.com)
   - Navigate to your wallet set
   - Use Circle's testnet mint/faucet feature to add test USDC
   - Or use Polygon Amoy testnet faucet

### Important Notes

- **Wallets must be in the same wallet set** to transfer between them
- Test USDC is required in the system wallet before transfers will work
- For production, use Circle's mainnet environment

### Troubleshooting

**"System funding wallet not found"**:
- Run `node scripts/setup-circle-system-wallet.js` to create it
- Make sure `CIRCLE_SYSTEM_WALLET_ID` is set in `.env`

**"Insufficient balance" or transfer fails**:
- Check system wallet balance in Circle Console
- Fund the system wallet with more test USDC

**"Circle SDK not available"**:
- Make sure `CIRCLE_ENTITY_SECRET` is set in `.env`
- Run `node scripts/setup-circle-entity-secret.js` if needed

---

## 🎙️ Voice Agent Claim Retrieval

### Overview

The voice agent can retrieve claim information using the insurance member ID. The `/api/patient/benefits` endpoint supports member ID lookup.

### Endpoint Usage

**Get Claims by Member ID**:
```bash
curl "http://localhost:4000/api/patient/benefits?memberId=CIGNA901234&patientName=Emily%20Davis"
```

**Response includes**:
- Patient information
- Insurance information with `member_id`
- Claims array with:
  - `id`, `status`, `total_amount`
  - `service_code`, `diagnosis_code`
  - `pricing`: Pricing breakdown (if available)
  - `eob`: EOB calculation (if calculated)
  - `diagnosisCodes`: Array of diagnosis codes with descriptions

### Voice Agent Flow

1. Agent asks: "Can I get your insurance number to look up your billing information?"
2. User provides insurance number (e.g., "901234")
3. Agent calls `/voice/insurance/collect` with `member_id`
4. Agent calls `/api/patient/benefits` with `memberId` and `patientName`
5. Agent receives claims with detailed breakdown
6. Agent explains claim details using CPT and diagnosis code descriptions

---

## 🔗 Resources

- **Retell AI**: https://docs.retellai.com
- **Stedi API**: https://www.stedi.com/docs
- **FHIR R4**: https://www.hl7.org/fhir/
- **Stripe API**: https://stripe.com/docs/api
- **Circle API**: https://developers.circle.com
- **Epic FHIR**: https://fhir.epic.com

---

## 📚 Documentation

All documentation has been organized in the [`docs/`](./docs/) folder:

### Quick Links
- **Setup Guides**: [Setup](./docs/setup/README.md#getting-started-setup), [Stripe Issuing](./docs/integrations/README.md#stripe-issuing-stripe-issuing)
- **Open work:** [todos/PENDING.md](./todos/PENDING.md)
- **Architecture**: [Vision](./docs/architecture/README.md#vision-vision), [Payment Architecture](./docs/architecture/README.md#payments-payment-architecture)
- **RCM patient pay (Kelly)**: [RCM README](./docs/RCM/README.md)
- **API**: [API Documentation](./docs/api/README.md#api-documentation)
- **Deployment**: [Security](./docs/deployment/README.md#security-security-improvements), [Backup Strategy](./docs/deployment/README.md#guides-backup-strategy)
- **Voice Agent**: [Main voice agent prompt](./docs/voice-agent/prompts/kelly-voice-agent-prompt.md)

See [`docs/README.md`](./docs/README.md) for a complete index of all documentation.

---

## 📝 License

MIT License

---

## 🤝 Support

For issues and questions:
1. Check the troubleshooting section
2. Review API endpoint documentation in [`docs/api/`](./docs/api/)
3. Check server logs for error details
4. Verify environment variables are configured correctly (see [`docs/setup/README.md#getting-started-setup`](./docs/setup/README.md#getting-started-setup))

---

**Last Updated:** 2026-05-30  
**Version**: 3.1.0
