# Middleware Platform - Backend API

**Version**: 3.0.0  
**Status**: Production Ready

> **Documentation:** [docs/](../docs/README.md) is the repo-wide hub. **Middleware-specific** runbooks and Kelly/checkout specs live in **[docs/middleware-platform/](../docs/middleware-platform/README.md)** (not under `middleware-platform/docs/` except a short redirect [README](./docs/README.md)).

## Overview

The middleware platform is the core backend API for DocLittle, handling all business logic, database operations, and external API integrations.

## Architecture

### Core Components

- **server.js** - Main Express server with all API routes
- **database.js** - SQLite database with automatic migrations
- **services/** - Business logic layer
- **routes/** - API endpoint handlers
- **adapters/** - External API integrations
- **models/** - Data models
- **webhooks/** - Webhook handlers (Retell, Circle, etc.)
- **scripts/** - Utility scripts for setup and maintenance
- **__tests__/** - Jest tests (folder reserved; run `npm test` → `jest --passWithNoTests` if empty)

### Key Services

#### Healthcare Services
- **fhir-service.js** - FHIR R4 patient resource management
- **booking-service.js** - Appointment scheduling and management
- **insurance-service.js** - Stedi API integration for eligibility and claims
- **ehr-sync-service.js** - Epic/1upHealth EHR integration
- **ehr-aggregator-service.js** - EHR data aggregation
- **epic-adapter.js** - Epic SMART on FHIR adapter

#### Payment Services
- **payment-orchestrator.js** - Payment flow orchestration (Stripe PI, 3DS `return_url` to `/api/payment/success`)
- **ensure-merchant-order-from-voice-checkout.js** - Single path to create `merchant_orders` after pay (webhook + sync PI success; idempotent)
- **commerce-alerts.js** - Optional `COMMERCE_ALERT_WEBHOOK_URL` + `audit_events` on commerce failures
- **payment-service.js** - Stripe payment processing
- **circle-service.js** - Circle USDC wallet payments
- **mastercard-service.js** - Mastercard Agent Pay integration
- **visa-service.js** - Visa Agent Toolkit integration

## Kelly Triage Lifecycle

1. `KellyAgentService.processTurn` runs emergency and intent pre-checks.
2. Tool loop stores OPQRST and rich intake signals.
3. `run_triage_rag` produces specialty + confidence and updates triage state.
4. Booking sequence: slots -> schedule -> checkout creation -> code verify -> payment process.

See detailed flow in [`docs/middleware-platform/architecture-kelly-payment.md`](../docs/middleware-platform/architecture-kelly-payment.md).

## Payment Lifecycle

1. Checkout created (`/voice/appointments/checkout`)
2. Identity verified (`/voice/checkout/verify`)
3. Payment processed (`/process-payment` or `/api/payment/process`)
4. Settlement/audit updates and appointment payment status updates

Important: verification does not move funds; settlement occurs at payment processing stage.

#### Medical Coding
- **medical-coding-service.js** - Groq AI for ICD-10/CPT extraction
- **coding-orchestrator.js** - Medical coding workflow
- **pdf-coding-service.js** - PDF text extraction and processing
- **diagnosis-code-mapper.js** - ICD-10 code mapping

#### Other Services
- **email-service.js** - Email sending (SMTP/Azure)
- **sms-service.js** - Twilio SMS integration
- **fraud-detector.js** - Fraud detection and risk scoring
- **reminder-scheduler.js** - Appointment reminder scheduling
- **provider-service.js** - Provider dashboard data
- **patient-portal-service.js** - Patient portal data
- **payer-cache-service.js** - Insurance payer list caching
- **eob-calculation-service.js** - Explanation of Benefits calculations

## Database

### Key Tables

**FHIR Resources**:
- `fhir_patients` - Patient records (FHIR R4)
- `fhir_encounters` - Healthcare encounters
- `fhir_communications` - Patient communications
- `fhir_observations` - Clinical observations

**Appointments**:
- `appointments` - Appointment records

**Insurance**:
- `eligibility_checks` - Insurance eligibility results
- `insurance_claims` - Submitted insurance claims
- `patient_insurance` - Patient insurance information
- `insurance_payers` - Cached payer list

**EHR Integration**:
- `ehr_connections` - EHR OAuth connections
- `ehr_encounters` - Synced EHR encounters
- `ehr_conditions` - ICD-10 diagnosis codes
- `ehr_procedures` - CPT procedure codes

**Payments**:
- `voice_checkouts` - Payment checkout records
- `payment_tokens` - Email verification tokens
- `circle_transfers` - Circle USDC transfers

**Fraud Detection**:
- `fraud_checks` - Fraud risk assessments
- `fraud_attempts` - Blocked fraud attempts
- `fraud_blacklist` - Blacklisted entities
- `fraud_whitelist` - Whitelisted entities

### Database Migrations

Migrations run automatically on server startup. The `database.js` file includes all schema definitions and handles:
- Creating missing tables
- Adding missing columns
- Creating indexes
- Maintaining data integrity

## API Endpoints

### Voice Agent Endpoints (`/voice/*`)
- Appointment scheduling, confirmation, cancellation, rescheduling
- Insurance collection and eligibility checks
- Payment checkout creation
- Patient claim retrieval

### Admin Endpoints (`/api/admin/*`)
- Appointment management
- Patient management
- Insurance claims and eligibility
- Medical coding
- Circle payments

### Provider Endpoints (`/api/provider/*`)
- Today's schedule
- Next patient
- Live statistics

### Patient Portal Endpoints (`/api/patient/*`)
- Appointment management
- Benefits lookup
- Profile management

### FHIR Endpoints (`/fhir/*`)
- FHIR R4 compliant patient resources
- Encounter management
- Observation recording

## Environment Variables

See main [README.md](../README.md) for complete environment variable documentation.

**Required**:
- `PORT` - Server port (default: 4000)
- `RETELL_API_KEY` - Retell AI API key
- `RETELL_AGENT_ID` - Retell agent ID
- `STRIPE_SECRET_KEY` - Stripe secret key

**Optional**:
- `STEDI_API_KEY` - Stedi API key (for insurance)
- `CIRCLE_API_KEY` - Circle API key (for USDC payments)
- `GROQ_API_KEY` - Groq API key (for medical coding)
- `LANGSMITH_API_KEY` or `AP_Langchain` - LangSmith tracing (required in production)
- `POSTGRES_URL` - Postgres for LangGraph checkpoints (production)
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` - Twilio credentials
- `SMTP_*` or `AZURE_COMMUNICATION_*` - Email configuration

## Testing

### Run Tests

```bash
# Full suite (LangSmith, EOB, tool handlers, state transitions)
npm test

# Individual suites
npm run test:langsmith    # LangSmith tracing
npm run test:langgraph    # LangGraph state flow
npm run test:eob          # EOB calculation
npm run test:tool-handlers # validate-code-pair, suggest-codes
npm run test:state-transitions  # State machine
npm run test:accuracy     # Medical coding accuracy
npm run test:load         # Load test
npm run test:contract     # Stedi contract tests
```

See [tests/README.md](tests/README.md) for full test documentation.

## Scripts

### Setup Scripts
- `scripts/setup-circle-system-wallet.js` - Create Circle system wallet
- `scripts/setup-circle-entity-secret.js` - Configure Circle entity secret
- `scripts/setup-wallet-config.js` - Configure wallet settings

### Maintenance Scripts
- `scripts/backup-database.js` - Backup database
- `scripts/import-cpt-codes.js` - Import CPT codes
- `scripts/sync-epic-data.js` - Sync Epic EHR data
- `scripts/reconcile-langgraph-state.js` - Reconcile LangGraph vs DB (`npm run reconcile:langgraph`)
- `scripts/migrate-to-langgraph.js` - Seed LangGraph from DB (`npm run migrate:langgraph`)

### Test Scripts
- `scripts/test-circle-api-key.js` - Test Circle API connection
- `scripts/test-circle-wallets.js` - Test wallet operations
- `scripts/test-wallet-funding.js` - Test wallet funding

## Security

- Rate limiting on all endpoints
- Security headers (Helmet.js)
- Input sanitization
- SQL injection prevention (prepared statements)
- Webhook signature verification
- Fraud detection and blocking

## Deployment

### Railway Deployment

1. Connect GitHub repository
2. Set root directory to `middleware-platform`
3. Configure environment variables
4. Deploy automatically on push

See `railway.json` for configuration.

## Troubleshooting

### Common Issues

**Database Migration Errors**:
- Migrations run automatically on startup
- Check `database.js` for schema definitions

**Missing API Keys**:
- Verify all required environment variables are set
- Check Railway/Netlify environment variables

**Circle Wallet Errors**:
- Run `node scripts/setup-circle-system-wallet.js`
- Verify `CIRCLE_ENTITY_SECRET` is set

## Related Documentation

- [Main README](../README.md) - Project overview
- [API Documentation](../docs/api/API_DOCUMENTATION.md) - Complete API reference
- [Setup Guide](../docs/setup/getting-started/SETUP.md) - Setup instructions
- [Voice Agent Prompt](../docs/voice-agent/prompts/kelly-voice-agent-prompt.md) - Kelly voice agent configuration

