# DocLittle Platform Documentation

**Last Updated:** April 9, 2026

> **📌 Source of Truth**: This `docs/` folder is the canonical documentation for the platform. All `.md` files belong in `docs/` (or `todos/` for active/archive task tracking).  
> **Overlapping topics (Kelly vs voice vs checkout):** start with **[meta/CANONICAL_DOC_MAP.md](./meta/CANONICAL_DOC_MAP.md)** so you do not maintain the same story in two places.

### Documentation placement policy (April 2026)

- Canonical docs: `docs/`
- Task tracking only: `todos/pending` and `todos/archive`
- Non-canonical root exceptions: `README.md`, `CONTRIBUTING.md`
- Migrated legacy docs from module folders: `docs/repo-migrated/`

### For new developers

1. Read **root [`CONTRIBUTING.md`](../CONTRIBUTING.md)** — PR checklist and commands that mirror CI.
2. Follow **[Setup Guide](./setup/getting-started/SETUP.md)** and copy env files from `middleware-platform/.env.example` / `patient-app/.env.example`.
3. Kelly LLM env and debug flags: **[KELLY_ENV_AND_DEBUG.md](./development/KELLY_ENV_AND_DEBUG.md)**.
4. What CI actually runs vs deploy: **[CI_AND_DEPLOY_SOURCE_OF_TRUTH.md](./deployment/CI_AND_DEPLOY_SOURCE_OF_TRUTH.md)**.
5. Code layout: **[CODE_STRUCTURE.md](./development/guides/CODE_STRUCTURE.md)**.
6. Staging-only product checks (quote parity, chat → pay): **[STAGING_PRODUCT_VERIFICATION.md](./testing/STAGING_PRODUCT_VERIFICATION.md)**.
7. Architecture decisions (ADRs): **[architecture/decisions/README.md](./architecture/decisions/README.md)**.
8. Agentic checkout file map: **[AGENTIC_CHECKOUT_FILE_MAP.md](./architecture/commerce/AGENTIC_CHECKOUT_FILE_MAP.md)**.
9. `server.js` policy: **[SERVER_JS_REFACTOR_POLICY.md](./development/SERVER_JS_REFACTOR_POLICY.md)**.
10. Quarterly maintenance checklist: **[PERIODIC_MAINTENANCE.md](./development/PERIODIC_MAINTENANCE.md)**.
11. Secret scanning expectations: **[SECRET_SCANNING.md](./security/SECRET_SCANNING.md)**.
12. Browser E2E status: **[E2E_STATUS.md](./testing/E2E_STATUS.md)**.

---

## 📊 Documentation Audit (April 9, 2026)

- **Total .md files (repo, excluding `node_modules` / `.venv`):** ~249 — run `find . -name '*.md' -not -path '*/node_modules/*'` for current count. Historical note: 142 was cited after Phases 1–5 consolidation.
- **Consolidation plan:** [meta/DOCUMENTATION_AUDIT_AND_CONSOLIDATION_PLAN.md](./meta/DOCUMENTATION_AUDIT_AND_CONSOLIDATION_PLAN.md)
- **Phase 1 & 2 applied:** Empty file + placeholder folders removed. (Legacy `PATIENT_BOOKING_AND_TRIAGE_GAPS.md` was removed; triage phased roadmap is **complete** and [archived](../todos/archive/TRIAGE_CONSOLIDATED_PHASED_TODOS.md); active gap work: [meta/GAP_ANALYSIS_RICHER_TRIAGE_AND_RECORDS.md](./meta/GAP_ANALYSIS_RICHER_TRIAGE_AND_RECORDS.md).)

---

## 📚 Quick Navigation

### 🚀 Getting Started
- **[Setup Guide](./setup/getting-started/SETUP.md)** - Initial platform setup
- **[Deployment Guide](./deployment/guides/DEPLOYMENT_GUIDE.md)** - Production deployment
- **[API Documentation](./api/API_DOCUMENTATION.md)** - API reference

### 📖 Core Documentation

#### Architecture
- **[Architecture decisions (ADRs)](./architecture/decisions/README.md)** — SQLite, Kelly LLM, agentic checkout surfaces
- **[Agentic checkout file map](./architecture/commerce/AGENTIC_CHECKOUT_FILE_MAP.md)** — web, RN, API ownership
- **[Platform Vision](./architecture/vision/VISION.md)** - Platform goals and roadmap
- **[Healthcare Assessment](./architecture/healthcare/HEALTHCARE_ASSESSMENT.md)** - Healthcare platform analysis
- **[Payment Architecture](./architecture/payments/PAYMENT_ARCHITECTURE.md)** - Payment system design
- **[Financial Layer](./architecture/financial/FINANCIAL_LAYER_ARCHITECTURE.md)** - Insurance, claims, EOB, Tiba
- **[Multi-Tenant Architecture](./architecture/multi-tenant/MULTI_TENANT_VOICE_AGENT.md)** - Multi-tenant design
- **[Database Schema](./architecture/database/DATABASE_SCHEMA_APPROACH.md)** - Database design

#### Development
- **[Invoice Billing System](./development/invoice-billing/IMPLEMENTATION_SUMMARY.md)** - Invoice system implementation
- **[Code Reviews](./development/code-reviews/CODE_REVIEW_AND_CLEANUP.md)** - Code review findings
- **[Improvement Plan](./development/IMPROVEMENT_PLAN.md)** - Codebase improvements
- **[Code Structure](./development/guides/CODE_STRUCTURE.md)** - Code organization
- **[Reliability Guide](./development/guides/RELIABILITY.md)** - Reliability patterns
- **[Template Variables](./development/templates.md)** - Automation email/SMS template variables
- **[GitHub Tasks](./development/GITHUB_TASKS.md)** - Repo structure, branch hygiene
- **[Master TODO](./development/MASTER_TODO_FULL.md)** - Full platform roadmap

#### Admin Portal
- **[Admin Portal Structure](./admin-portal/ADMIN_PORTAL_STRUCTURE.md)** - Admin dashboard structure and URLs
- **[Admin Portal Testing](./admin-portal/ADMIN_PORTAL_TESTING.md)** - Testing guide

#### API & Integrations
- **[API Reference](./api/API_DOCUMENTATION.md)** - Complete API documentation
- **[Invoice API](./api/INVOICE_API.md)** - Invoice endpoints
- **[Stedi Integration](./integrations/stedi/api/STEDI_API_ENDPOINTS.md)** - Stedi API
- **[UHC FHIR Integration](./integrations/uhc/fhir/UHC_FHIR_SERVICE_USAGE.md)** - UHC FHIR
- **[Stripe Issuing](./integrations/stripe/issuing/STRIPE_ISSUING.md)** - Stripe cards

#### Setup & Configuration
- **[Main Setup](./setup/getting-started/SETUP.md)** - Platform setup
- **[Stripe Issuing Setup](./integrations/stripe/issuing/STRIPE_ISSUING.md)** - Stripe configuration
- **[Google OAuth](./setup/google/GOOGLE_OAUTH_COMPLETE_GUIDE.md)** - Google Calendar OAuth
- **[Azure Configuration](./azure/AZURE_AUTOMATION.md)** - Azure setup

#### Deployment
- **[Deployment Guide](./deployment/guides/DEPLOYMENT_GUIDE.md)** - Main deployment guide
- **[Azure Deployment](./deployment/guides/basic/QUICK_DEPLOYMENT_GUIDE.md)** - Quick Azure deploy
- **[DNS Configuration](./deployment/dns/ionos/IONOS_DNS_SETUP.md)** - DNS setup
- **[SSL Setup](./deployment/dns/ssl/DOCLITTLE_SITE_SSL_SETUP.md)** - SSL certificates
- **[Security](./deployment/security/PRODUCTION_DEPLOYMENT_API_KEYS.md)** - Security setup
- **[Database Migration](./deployment/database/POSTGRES_MIGRATION.md)** - Postgres migration

#### User Guides
- **[Invoice Workflow](./user-guides/INVOICE_WORKFLOW.md)** - Invoice generation workflow
- **[Clinic Onboarding](./onboarding/CLINIC_ONBOARDING_CHECKLIST.md)** - Clinic setup

#### Patient booking, triage & agentic commerce
- **[Richer Triage & Records](./meta/GAP_ANALYSIS_RICHER_TRIAGE_AND_RECORDS.md)** — Schema, records Q&A
- **[Public agentic checkout](./architecture/commerce/PUBLIC_AGENTIC_CHECKOUT.md)** — Landing → quote → pay, Kelly tools, APIs
- **[Triage phased todos (archived, all complete)](../todos/archive/TRIAGE_CONSOLIDATED_PHASED_TODOS.md)** — Historical phased roadmap
- **[Agentic checkout backlog / status](../todos/pending/AGENTIC_CHECKOUT_UI_AND_BACKEND_TODOS.md)** — Backend audit + open items (read status at top). Frontend UI spec (complete): [archive](../todos/archive/AGENTIC_CHECKOUT_UI_FRONTEND_TODOS.md).

#### Voice Agent, Video Consult & Medical Coding
- **[Hybrid Architecture Overview](./architecture/overview/HYBRID_ARCHITECTURE_OVERVIEW.md)** - Voice vs Video vs PDF, shared RAG/codes, boundaries
- **[Video Consult](./architecture/care-delivery/VIDEO_CONSULT.md)** - LiveKit video: flow, env, runbook
- **[Landing Try now & LiveKit](./architecture/experience/LANDING_TRY_NOW_LIVEKIT.md)** - Skin & Care landing camera-first UI, `try-landing-*` rooms, Kelly vs LiveKit
- **[Voice Agent Config](./voice-agent/README.md)** - Voice agent setup
- **[Medical Coding Runbook](./architecture/voice-agent/RUNBOOK.md)** - Imports, evaluation, tools, configure-retell
- **[Tool Schemas](./architecture/voice-agent/TOOL_SCHEMAS.md)** - Retell functions (suggest_codes_from_symptoms, extract_medical_text, etc.)
- **[LangGraph & LangSmith](./middleware-platform/LANGGRAPH_LANGSMITH.md)** - Tracing, what’s monitored, scripts

---

## 📁 Documentation Structure

```
docs/
├── README.md                          # This file
│
├── api/                               # API Documentation
│   ├── API_DOCUMENTATION.md          # Main API reference
│   └── INVOICE_API.md                # Invoice API endpoints
│
├── architecture/                      # System Architecture
│   ├── vision/                       # Platform vision
│   ├── healthcare/                   # Healthcare analysis
│   ├── financial/                    # Insurance, claims, Tiba
│   ├── ai/                           # LangChain/LangGraph
│   ├── media/                        # Media layer
│   ├── middleware/                   # Brain/context improvements
│   ├── maintenance/                  # Architecture issues/fixes
│   ├── database/                     # Database design
│   ├── multi-tenant/                 # Multi-tenant architecture
│   ├── payments/                     # Payment architecture
│   └── voice-agent/                  # Voice agent architecture
│
├── development/                       # Development Guides
│   ├── invoice-billing/              # Invoice system docs
│   ├── code-reviews/                 # Code review findings
│   ├── guides/                       # Development guides
│   ├── templates.md                  # Automation template variables
│   ├── IMPROVEMENT_PLAN.md           # Improvement roadmap
│   ├── GITHUB_TASKS.md               # Repo hygiene tasks
│   ├── MASTER_TODO_FULL.md           # Full platform roadmap
│   └── (TECH_LEAD_CLEANUP archived → archive/TECH_LEAD_CLEANUP.md)
│
├── admin-portal/                      # Admin Portal
│   ├── ADMIN_PORTAL_STRUCTURE.md     # Structure and URLs
│   ├── ADMIN_PORTAL_TESTING.md       # Testing guide
│   └── (ADMIN_PORTAL_FIXES_COMPLETE archived → archive/)
│
├── deployment/                        # Deployment Guides
│   ├── guides/                       # Deployment guides (incl. DEPLOYMENT_GUIDE.md)
│   ├── azure/                        # Azure-specific setup
│   ├── database/                     # Database deployment
│   ├── dns/                          # DNS configuration
│   └── security/                     # Security setup
│
├── setup/                            # Setup & Configuration
│   ├── getting-started/              # Main setup guide (SETUP.md)
│   ├── stripe/                       # Stripe Issuing setup
│   └── google/                       # Google OAuth setup
│
├── integrations/                      # Third-Party Integrations
│   ├── stedi/                        # Stedi integration
│   ├── stripe/                       # Stripe integration
│   └── uhc/                          # UHC integration
│
├── user-guides/                       # User Documentation
│   └── INVOICE_WORKFLOW.md           # Invoice workflow
│
├── voice-agent/                       # Voice Agent
│   └── prompts/                      # Agent prompts
│
├── onboarding/                        # Onboarding
│   └── CLINIC_ONBOARDING_CHECKLIST.md
│
├── azure/                            # Azure-Specific
│   └── AZURE_AUTOMATION.md
│
├── middleware-platform/              # Backend service: Kelly, Skin & Care, checkout runbooks, Retell, security checklists (see README in that folder)
│   ├── README.md                    # Index of all middleware-specific docs
│   ├── kelly-phase-prompt-architecture.md
│   ├── architecture-kelly-payment.md
│   └── … (runbooks, Retell, Step10, standards — not all listed here)
│
└── archive/                          # Archived Files
    └── azure-debug-scripts/          # Old debug scripts
```

---

## 🎯 Documentation by Use Case

### I want to...
- **Find all documentation** → This README (docs is the source of truth)
- **Deploy the platform** → [Deployment Guide](./deployment/guides/DEPLOYMENT_GUIDE.md)
- **Set up Stripe** → [Stripe Issuing Guide](./integrations/stripe/issuing/STRIPE_ISSUING.md)
- **Configure Google Calendar** → [Google OAuth Guide](./setup/google/GOOGLE_OAUTH_COMPLETE_GUIDE.md)
- **Understand the architecture** → [Architecture Overview](./architecture/vision/VISION.md)
- **Use the API** → [API Documentation](./api/API_DOCUMENTATION.md)
- **Generate invoices** → [Invoice Workflow](./user-guides/INVOICE_WORKFLOW.md)
- **Set up Azure** → [Azure Automation](./azure/AZURE_AUTOMATION.md)
- **Configure DNS** → [DNS Configuration](./deployment/dns/ionos/IONOS_DNS_SETUP.md)
- **Work on the Admin Portal** → [Admin Portal docs](./admin-portal/README.md)

---

## 📝 Documentation Standards

### File Naming
- Use `UPPERCASE_WITH_UNDERSCORES.md` for main documents
- Use `README.md` for folder indexes
- Use descriptive names that indicate content

### Structure
- Start with overview/description
- Include "Last Updated" date
- Use clear headings and sections
- Include code examples where relevant
- Add troubleshooting sections

### Maintenance
- Update "Last Updated" when modifying
- Keep related docs in sync
- Archive outdated docs to `archive/`
- Update this README when adding new docs

---

## 🔍 Search by Topic

### Payments
- [Payment Architecture](./architecture/payments/PAYMENT_ARCHITECTURE.md)
- [Stripe Issuing](./integrations/stripe/issuing/STRIPE_ISSUING.md)
- [Invoice System](./development/invoice-billing/IMPLEMENTATION_SUMMARY.md)

### Multi-Tenancy
- [Multi-Tenant Architecture](./architecture/multi-tenant/MULTI_TENANT_VOICE_AGENT.md)
- [Tenant & DNS Setup](./deployment/dns/TENANT_AND_DNS_SETUP.md)
- [Automated Domain Setup](./deployment/azure/AUTOMATED_TENANT_DOMAIN_SETUP.md)

### Healthcare
- [Healthcare Assessment](./architecture/healthcare/HEALTHCARE_ASSESSMENT.md)
- [UHC FHIR Integration](./integrations/uhc/fhir/UHC_FHIR_SERVICE_USAGE.md)
- [Stedi Integration](./integrations/stedi/api/STEDI_API_ENDPOINTS.md)

### Voice Agent & Medical Coding
- [Voice Agent Config](./voice-agent/README.md)
- [Video Consult](./architecture/care-delivery/VIDEO_CONSULT.md)
- [Landing Try now & LiveKit](./architecture/experience/LANDING_TRY_NOW_LIVEKIT.md)
- [Medical Coding Runbook](./architecture/voice-agent/RUNBOOK.md)
- [Retell Configuration](./middleware-platform/RETELL_CONFIG_QUICK_REFERENCE.md)
- [Voice Agent Todo & Status](./architecture/voice-agent/VOICE_AGENT_TODO_AND_STATUS.md)

---

## 📊 Documentation Status

- ✅ **Architecture**: Complete
- ✅ **API**: Complete (with Invoice API)
- ✅ **Deployment**: Complete
- ✅ **Setup**: Complete
- ✅ **User Guides**: Complete
- ✅ **Integrations**: Complete

---

## 🧹 Cleanup record

One-time consolidation (Feb 2026): Video Consult and LangSmith docs merged; indexes updated. See **[TECH_LEAD_CLEANUP.md](./archive/TECH_LEAD_CLEANUP.md)** for details.

---

## 🤝 Contributing

When adding new documentation:
1. Place in appropriate subfolder
2. Use consistent naming convention
3. Update this README
4. Include "Last Updated" date
5. Follow documentation standards above

---

**Questions?** Check the relevant section above or search the docs folder.
