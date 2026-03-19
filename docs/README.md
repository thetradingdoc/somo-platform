# DocLittle Platform Documentation

**Last Updated**: March 2026

> **📌 Source of Truth**: This `docs/` folder is the canonical documentation for the platform. All `.md` files belong in `docs/` under their respective subfolders. Root and module READMEs point here.

---

## 📊 Documentation Audit (March 2026)

- **Total .md files:** 142 (down from 167; Phases 1–5 consolidation applied)
- **Consolidation plan:** [DOCUMENTATION_AUDIT_AND_CONSOLIDATION_PLAN.md](./DOCUMENTATION_AUDIT_AND_CONSOLIDATION_PLAN.md)
- **Phase 1 & 2 applied:** Empty file + placeholder folders removed; patient/triage/matching/specialist merged into [PATIENT_BOOKING_AND_TRIAGE_GAPS.md](./PATIENT_BOOKING_AND_TRIAGE_GAPS.md)

---

## 📚 Quick Navigation

### 🚀 Getting Started
- **[Setup Guide](./setup/getting-started/SETUP.md)** - Initial platform setup
- **[Deployment Guide](./deployment/guides/DEPLOYMENT_GUIDE.md)** - Production deployment
- **[API Documentation](./api/API_DOCUMENTATION.md)** - API reference

### 📖 Core Documentation

#### Architecture
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

#### Patient Booking & Triage Gaps
- **[Patient Booking & Triage Gaps](./PATIENT_BOOKING_AND_TRIAGE_GAPS.md)** - Flow, all gaps (T/M/S/C/U), golden path, phased execution
- **[Richer Triage & Records](./GAP_ANALYSIS_RICHER_TRIAGE_AND_RECORDS.md)** - Schema, records Q&A

#### Voice Agent, Video Consult & Medical Coding
- **[Hybrid Architecture Overview](./architecture/HYBRID_ARCHITECTURE_OVERVIEW.md)** - Voice vs Video vs PDF, shared RAG/codes, boundaries
- **[Video Consult](./architecture/VIDEO_CONSULT.md)** - LiveKit video: flow, env, runbook
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
├── middleware-platform/              # Platform Config
│   └── RETELL_CONFIG_QUICK_REFERENCE.md
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
