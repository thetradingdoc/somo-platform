# DocLittle Platform Documentation

**Last Updated:** April 29, 2026

> **📌 Source of Truth**: This `docs/` folder is the canonical documentation for the platform. All `.md` files belong in `docs/` (or `todos/` for active/archive task tracking).  
> **Overlapping topics (Kelly vs voice vs checkout):** start with **[meta/CANONICAL_DOC_MAP.md](./meta/README.md#canonical-doc-map)** so you do not maintain the same story in two places.

### Documentation placement policy (April 2026)

- Canonical docs: `docs/`
- Task tracking only: `todos/pending` and `todos/archive`
- Non-canonical root exceptions: `README.md`, `CONTRIBUTING.md`
- Migrated legacy docs from module folders: `docs/repo-migrated/`

### For new developers

1. Read **root [`CONTRIBUTING.md`](../CONTRIBUTING.md)** — PR checklist and commands that mirror CI.
2. Follow **[Setup Guide](./setup/README.md#getting-started-setup)** and copy env files from `middleware-platform/.env.example` / `patient-app/.env.example`.
3. Kelly LLM env and debug flags: **[KELLY_ENV_AND_DEBUG.md](./development/README.md#kelly-env-and-debug)**.
4. What CI actually runs vs deploy: **[CI_AND_DEPLOY_SOURCE_OF_TRUTH.md](./deployment/README.md#ci-and-deploy-source-of-truth)**.
5. Code layout: **[CODE_STRUCTURE.md](./development/README.md#guides-code-structure)**.
6. Staging-only product checks (quote parity, chat → pay): **[STAGING_PRODUCT_VERIFICATION.md](./testing/README.md#staging-product-verification)**.
7. Architecture decisions (ADRs): **[architecture/decisions/README.md](./architecture/README.md#decisions-readme)**.
8. Agentic checkout file map: **[AGENTIC_CHECKOUT_FILE_MAP.md](./architecture/README.md#commerce-agentic-checkout-file-map)**.
9. `server.js` policy: **[SERVER_JS_REFACTOR_POLICY.md](./development/README.md#server-js-refactor-policy)**.
10. Quarterly maintenance checklist: **[PERIODIC_MAINTENANCE.md](./development/README.md#periodic-maintenance)**.
11. Secret scanning expectations: **[SECRET_SCANNING.md](./security/SECRET_SCANNING.md)**.
12. Browser E2E status: **[E2E_STATUS.md](./testing/README.md#e2e-status)**.
13. Batch line-level docs gap tracker: **[CODEBASE_BATCH_REVIEW_AND_DOC_GAPS.md](./meta/CODEBASE_BATCH_REVIEW_AND_DOC_GAPS.md)**.

---

## 📊 Documentation Audit (April 9, 2026)

- **Total .md files (repo, excluding `node_modules` / `.venv`):** ~249 — run `find . -name '*.md' -not -path '*/node_modules/*'` for current count. Historical note: 142 was cited after Phases 1–5 consolidation.
- **Consolidation plan:** [meta/DOCUMENTATION_AUDIT_AND_CONSOLIDATION_PLAN.md](./meta/README.md#documentation-audit-and-consolidation-plan)
- **Phase 1 & 2 applied:** Empty file + placeholder folders removed. (Legacy `PATIENT_BOOKING_AND_TRIAGE_GAPS.md` was removed; triage phased roadmap is **complete** and [archived](../todos/archive/TRIAGE_CONSOLIDATED_PHASED_TODOS.md); active gap work: [meta/GAP_ANALYSIS_RICHER_TRIAGE_AND_RECORDS.md](./meta/README.md#gap-analysis-richer-triage-and-records).)

---

## 📚 Quick Navigation

### 🚀 Getting Started
- **[Setup Guide](./setup/README.md#getting-started-setup)** - Initial platform setup
- **[Deployment Guide](./deployment/README.md#guides-deployment-guide)** - Production deployment
- **[API Documentation](./api/README.md#api-documentation)** - API reference

### 📖 Core Documentation

#### Documentation health and gap tracking
- **[Codebase Batch Review And Documentation Gaps](./meta/CODEBASE_BATCH_REVIEW_AND_DOC_GAPS.md)** - tracked gap list by batch (`all codebase`, `routes`, `services`)

#### Architecture
- **[Architecture decisions (ADRs)](./architecture/README.md#decisions-readme)** — SQLite, Kelly LLM, agentic checkout surfaces
- **[Agentic checkout file map](./architecture/README.md#commerce-agentic-checkout-file-map)** — web, RN, API ownership
- **[Platform Vision](./architecture/README.md#vision-vision)** - Platform goals and roadmap
- **[Healthcare Assessment](./architecture/README.md#healthcare-healthcare-assessment)** - Healthcare platform analysis
- **[Payment Architecture](./architecture/README.md#payments-payment-architecture)** - Payment system design
- **[Financial Layer](./architecture/README.md#financial-financial-layer-architecture)** - Insurance, claims, EOB, Tiba
- **[Multi-Tenant Architecture](./architecture/README.md#multi-tenant-multi-tenant-voice-agent)** - Multi-tenant design
- **[Database Schema](./architecture/README.md#database-database-schema-approach)** - Database design

#### Development
- **[Invoice Billing System](./development/README.md#invoice-billing-implementation-summary)** - Invoice system implementation
- **[Code Reviews](./development/README.md#code-reviews-code-review-and-cleanup)** - Code review findings
- **[Improvement Plan](./development/README.md#improvement-plan)** - Codebase improvements
- **[Code Structure](./development/README.md#guides-code-structure)** - Code organization
- **[Runtime Entrypoints And Call Paths](./architecture/RUNTIME_ENTRYPOINTS_AND_CALL_PATHS.md)** - End-to-end runtime ownership map
- **[Code Ownership By Surface](./development/CODE_OWNERSHIP_BY_SURFACE.md)** - Where to change what
- **[Scripts Operations Map](./development/SCRIPTS_OPERATIONS_MAP.md)** - Script risk tiers and execution map
- **[Reliability Guide](./development/README.md#guides-reliability)** - Reliability patterns
- **[Template Variables](./development/README.md#templates)** - Automation email/SMS template variables
- **[GitHub Tasks](./development/README.md#github-tasks)** - Repo structure, branch hygiene
- **[Master TODO](./development/README.md#master-todo-full)** - Full platform roadmap

#### Admin Portal
- **[Admin Portal Structure](./admin-portal/README.md#admin-portal-structure)** - Admin dashboard structure and URLs
- **[Admin Portal Testing](./admin-portal/README.md#admin-portal-testing)** - Testing guide

#### API & Integrations
- **[API Reference](./api/README.md#api-documentation)** - Complete API documentation
- **[Invoice API](./api/README.md#invoice-api)** - Invoice endpoints
- **[Stedi Integration](./integrations/README.md#stedi-api-stedi-api-endpoints)** - Stedi API
- **[UHC FHIR Integration](./integrations/README.md#uhc-fhir-uhc-fhir-service-usage)** - UHC FHIR
- **[Stripe Issuing](./integrations/README.md#stripe-issuing-stripe-issuing)** - Stripe cards

#### Setup & Configuration
- **[Main Setup](./setup/README.md#getting-started-setup)** - Platform setup
- **[Stripe Issuing Setup](./integrations/README.md#stripe-issuing-stripe-issuing)** - Stripe configuration
- **[Google OAuth](./setup/README.md#google-google-oauth-complete-guide)** - Google Calendar OAuth
- **[Azure Configuration](./azure/README.md#azure-automation)** - Azure setup

#### Deployment
- **[Deployment Guide](./deployment/README.md#guides-deployment-guide)** - Main deployment guide
- **[Azure Deployment](./deployment/README.md#guides-basic-quick-deployment-guide)** - Quick Azure deploy
- **[DNS Configuration](./deployment/README.md#dns-ionos-ionos-dns-setup)** - DNS setup
- **[SSL Setup](./deployment/README.md#dns-ssl-doclittle-site-ssl-setup)** - SSL certificates
- **[Security](./deployment/README.md#security-production-deployment-api-keys)** - Security setup
- **[Database Migration](./deployment/README.md#database-postgres-migration)** - Postgres migration

#### User Guides
- **[Invoice Workflow](./user-guides/INVOICE_WORKFLOW.md)** - Invoice generation workflow
- **[Clinic Onboarding](./onboarding/README.md#clinic-onboarding-checklist)** - Clinic setup

#### Patient booking, triage & agentic commerce
- **[Richer Triage & Records](./meta/README.md#gap-analysis-richer-triage-and-records)** — Schema, records Q&A
- **[Public agentic checkout](./architecture/README.md#commerce-public-agentic-checkout)** — Landing → quote → pay, Kelly tools, APIs
- **[Triage phased todos (archived, all complete)](../todos/archive/TRIAGE_CONSOLIDATED_PHASED_TODOS.md)** — Historical phased roadmap
- **[Agentic checkout backlog / status](../todos/pending/AGENTIC_CHECKOUT_UI_AND_BACKEND_TODOS.md)** — Backend audit + open items (read status at top). Frontend UI spec (complete): [archive](../todos/archive/AGENTIC_CHECKOUT_UI_FRONTEND_TODOS.md).

#### Voice Agent, Video Consult & Medical Coding
- **[Hybrid Architecture Overview](./architecture/README.md#overview-hybrid-architecture-overview)** - Voice vs Video vs PDF, shared RAG/codes, boundaries
- **[Video Consult](./architecture/README.md#care-delivery-video-consult)** - LiveKit video: flow, env, runbook
- **[Landing Try now & LiveKit](./architecture/README.md#experience-landing-try-now-livekit)** - Skin & Care landing camera-first UI, `try-landing-*` rooms, Kelly vs LiveKit
- **[Voice Agent Config](./voice-agent/README.md)** - Voice agent setup
- **[Medical Coding Runbook](./architecture/README.md#voice-agent-runbook)** - Imports, evaluation, tools, configure-retell
- **[Tool Schemas](./architecture/README.md#voice-agent-tool-schemas)** - Retell functions (suggest_codes_from_symptoms, extract_medical_text, etc.)
- **[LangGraph & LangSmith](./middleware-platform/README.md#langgraph-langsmith)** — Tracing, what’s monitored, scripts (consolidated middleware docs)

---

## 📁 Documentation Structure

Most **top-level** folders under `docs/` use a **single** `README.md` (former per-topic `.md` files are merged with a table of contents and anchors). **Exceptions:** `middleware-platform/` and `reasoning/` were consolidated earlier; `voice-agent/` keeps `README.md` plus `prompts/*.md` for Retell/runtime loaders; `user-guides/` may keep small standalone guides.

```
docs/
├── README.md                    # This hub
├── admin-portal/README.md
├── api/README.md
├── architecture/README.md       # largest: all former subfolders merged
├── archive/README.md
├── azure/README.md
├── compliance/README.md
├── configuration/README.md
├── deployment/README.md
├── development/README.md
├── email/README.md
├── integrations/README.md
├── meta/README.md
├── middleware-platform/README.md
├── onboarding/README.md
├── products/README.md
├── reasoning/README.md
├── repo-migrated/README.md
├── runbooks/README.md
├── setup/README.md
├── testing/README.md
├── user-guides/                 # e.g. INVOICE_WORKFLOW.md
├── voice-agent/                 # README + prompts/ (runtime)
├── _consolidated_path_redirects.json   # old path → README#anchor (for link updates)
└── …                            # security, geolocation, knowledge-base, etc. as present
```

---

## 🎯 Documentation by Use Case

### I want to...
- **Find all documentation** → This README (docs is the source of truth)
- **Deploy the platform** → [Deployment Guide](./deployment/README.md#guides-deployment-guide)
- **Set up Stripe** → [Stripe Issuing Guide](./integrations/README.md#stripe-issuing-stripe-issuing)
- **Configure Google Calendar** → [Google OAuth Guide](./setup/README.md#google-google-oauth-complete-guide)
- **Understand the architecture** → [Architecture Overview](./architecture/README.md#vision-vision)
- **Use the API** → [API Documentation](./api/README.md#api-documentation)
- **Generate invoices** → [Invoice Workflow](./user-guides/INVOICE_WORKFLOW.md)
- **Set up Azure** → [Azure Automation](./azure/README.md#azure-automation)
- **Configure DNS** → [DNS Configuration](./deployment/README.md#dns-ionos-ionos-dns-setup)
- **Work on the Admin Portal** → [Admin Portal docs](./admin-portal/README.md#readme)

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
- [Payment Architecture](./architecture/README.md#payments-payment-architecture)
- [Stripe Issuing](./integrations/README.md#stripe-issuing-stripe-issuing)
- [Invoice System](./development/README.md#invoice-billing-implementation-summary)

### Multi-Tenancy
- [Multi-Tenant Architecture](./architecture/README.md#multi-tenant-multi-tenant-voice-agent)
- [Tenant & DNS Setup](./deployment/README.md#dns-tenant-and-dns-setup)
- [Automated Domain Setup](./deployment/README.md#azure-automated-tenant-domain-setup)

### Healthcare
- [Healthcare Assessment](./architecture/README.md#healthcare-healthcare-assessment)
- [UHC FHIR Integration](./integrations/README.md#uhc-fhir-uhc-fhir-service-usage)
- [Stedi Integration](./integrations/README.md#stedi-api-stedi-api-endpoints)

### Voice Agent & Medical Coding
- [Voice Agent Config](./voice-agent/README.md)
- [Video Consult](./architecture/README.md#care-delivery-video-consult)
- [Landing Try now & LiveKit](./architecture/README.md#experience-landing-try-now-livekit)
- [Medical Coding Runbook](./architecture/README.md#voice-agent-runbook)
- [Retell Configuration](./middleware-platform/README.md#retell-config-quick-reference)
- [Voice Agent Todo & Status](./architecture/README.md#voice-agent-voice-agent-todo-and-status)

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

One-time consolidation (Feb 2026): Video Consult and LangSmith docs merged; indexes updated. See **[TECH_LEAD_CLEANUP.md](./archive/README.md#tech-lead-cleanup)** for details.

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
