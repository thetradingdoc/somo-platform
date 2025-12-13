# DocLittle Platform Documentation

**Last Updated**: December 2024

> **Quick Summary**: See [SUMMARY.md](./SUMMARY.md) for overview

---

## 📚 Quick Navigation

### 🚀 Getting Started
- **[Setup Guide](./setup/SETUP.md)** - Initial platform setup
- **[Deployment Guide](./deployment/DEPLOYMENT_GUIDE.md)** - Production deployment
- **[API Documentation](./api/API_DOCUMENTATION.md)** - API reference

### 📖 Core Documentation

#### Architecture
- **[Platform Vision](./architecture/VISION.md)** - Platform goals and roadmap
- **[Healthcare Assessment](./architecture/HEALTHCARE_ASSESSMENT.md)** - Healthcare platform analysis
- **[Payment Architecture](./architecture/payments/PAYMENT_ARCHITECTURE.md)** - Payment system design
- **[Multi-Tenant Architecture](./architecture/multi-tenant/MULTI_TENANT_VOICE_AGENT.md)** - Multi-tenant design
- **[Database Schema](./architecture/database/DATABASE_SCHEMA_APPROACH.md)** - Database design

#### Development
- **[Invoice Billing System](./development/invoice-billing/IMPLEMENTATION_SUMMARY.md)** - Invoice system implementation
- **[Code Reviews](./development/code-reviews/CODE_REVIEW_AND_CLEANUP.md)** - Code review findings
- **[Improvement Plan](./development/IMPROVEMENT_PLAN.md)** - Codebase improvements
- **[Code Structure](./development/guides/CODE_STRUCTURE.md)** - Code organization
- **[Reliability Guide](./development/guides/RELIABILITY.md)** - Reliability patterns

#### API & Integrations
- **[API Reference](./api/API_DOCUMENTATION.md)** - Complete API documentation
- **[Invoice API](./api/INVOICE_API.md)** - Invoice endpoints
- **[Stedi Integration](./integrations/stedi/api/STEDI_API_ENDPOINTS.md)** - Stedi API
- **[UHC FHIR Integration](./integrations/uhc/fhir/UHC_FHIR_SERVICE_USAGE.md)** - UHC FHIR
- **[Stripe Issuing](./integrations/stripe/issuing/STRIPE_ISSUING_STATUS.md)** - Stripe cards

#### Setup & Configuration
- **[Main Setup](./setup/SETUP.md)** - Platform setup
- **[Stripe Issuing Setup](./setup/STRIPE_ISSUING_COMPLETE_GUIDE.md)** - Stripe configuration
- **[Google OAuth](./setup/google/GOOGLE_OAUTH_COMPLETE_GUIDE.md)** - Google Calendar OAuth
- **[Azure Configuration](./azure/AZURE_AUTOMATION.md)** - Azure setup

#### Deployment
- **[Deployment Guide](./deployment/DEPLOYMENT_GUIDE.md)** - Main deployment guide
- **[Azure Deployment](./deployment/guides/basic/QUICK_DEPLOYMENT_GUIDE.md)** - Quick Azure deploy
- **[DNS Configuration](./deployment/dns/ionos/IONOS_DNS_CONFIGURATION.md)** - DNS setup
- **[SSL Setup](./deployment/dns/ssl/DOCLITTLE_SITE_SSL_SETUP.md)** - SSL certificates
- **[Security](./deployment/security/PRODUCTION_DEPLOYMENT_API_KEYS.md)** - Security setup
- **[Database Migration](./deployment/database/POSTGRES_MIGRATION.md)** - Postgres migration

#### User Guides
- **[Invoice Workflow](./user-guides/INVOICE_WORKFLOW.md)** - Invoice generation workflow
- **[Clinic Onboarding](./onboarding/CLINIC_ONBOARDING_CHECKLIST.md)** - Clinic setup

#### Voice Agent
- **[Voice Agent Config](./voice-agent/README.md)** - Voice agent setup
- **[Prompts](./voice-agent/prompts/)** - Agent prompts

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
│   ├── VISION.md                     # Platform vision
│   ├── HEALTHCARE_ASSESSMENT.md      # Healthcare analysis
│   ├── database/                     # Database design
│   ├── multi-tenant/                 # Multi-tenant architecture
│   ├── payments/                     # Payment architecture
│   └── voice-agent/                  # Voice agent architecture
│
├── development/                       # Development Guides
│   ├── invoice-billing/              # Invoice system docs
│   ├── code-reviews/                 # Code review findings
│   ├── guides/                       # Development guides
│   └── IMPROVEMENT_PLAN.md           # Improvement roadmap
│
├── deployment/                        # Deployment Guides
│   ├── DEPLOYMENT_GUIDE.md           # Main deployment guide
│   ├── database/                     # Database deployment
│   ├── dns/                          # DNS configuration
│   ├── guides/                       # Deployment guides
│   └── security/                     # Security setup
│
├── setup/                            # Setup & Configuration
│   ├── SETUP.md                      # Main setup guide
│   ├── STRIPE_ISSUING_COMPLETE_GUIDE.md
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
- **Deploy the platform** → [Deployment Guide](./deployment/DEPLOYMENT_GUIDE.md)
- **Set up Stripe** → [Stripe Issuing Guide](./setup/STRIPE_ISSUING_COMPLETE_GUIDE.md)
- **Configure Google Calendar** → [Google OAuth Guide](./setup/google/GOOGLE_OAUTH_COMPLETE_GUIDE.md)
- **Understand the architecture** → [Architecture Overview](./architecture/VISION.md)
- **Use the API** → [API Documentation](./api/API_DOCUMENTATION.md)
- **Generate invoices** → [Invoice Workflow](./user-guides/INVOICE_WORKFLOW.md)
- **Set up Azure** → [Azure Automation](./azure/AZURE_AUTOMATION.md)
- **Configure DNS** → [DNS Configuration](./deployment/dns/ionos/IONOS_DNS_CONFIGURATION.md)

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
- [Stripe Issuing](./integrations/stripe/issuing/STRIPE_ISSUING_STATUS.md)
- [Invoice System](./development/invoice-billing/IMPLEMENTATION_SUMMARY.md)

### Multi-Tenancy
- [Multi-Tenant Architecture](./architecture/multi-tenant/MULTI_TENANT_VOICE_AGENT.md)
- [Tenant Subdomain Setup](./deployment/TENANT_SUBDOMAIN_SETUP.md)
- [Automated Domain Setup](./deployment/AUTOMATED_TENANT_DOMAIN_SETUP.md)

### Healthcare
- [Healthcare Assessment](./architecture/HEALTHCARE_ASSESSMENT.md)
- [UHC FHIR Integration](./integrations/uhc/fhir/UHC_FHIR_SERVICE_USAGE.md)
- [Stedi Integration](./integrations/stedi/api/STEDI_API_ENDPOINTS.md)

### Voice Agent
- [Voice Agent Config](./voice-agent/README.md)
- [Retell Configuration](./middleware-platform/RETELL_CONFIG_QUICK_REFERENCE.md)
- [Agent Prompts](./voice-agent/prompts/)

---

## 📊 Documentation Status

- ✅ **Architecture**: Complete
- ✅ **API**: Complete (with Invoice API)
- ✅ **Deployment**: Complete
- ✅ **Setup**: Complete
- ✅ **User Guides**: Complete
- ✅ **Integrations**: Complete

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
