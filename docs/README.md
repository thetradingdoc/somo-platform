# Somo Platform Documentation
> Last reviewed: 2026-06-22

**Last Updated:** 2026-06-22

### Start here (by role)

| Role | Read first |
|------|------------|
| **Clinicians & practice managers** | **[START_HERE_CLINICIAN.md](./START_HERE_CLINICIAN.md)** — phone, portal, billing, what to ignore |
| **Engineering / reorg planning** | **[solution-design/CODEBASE_REORGANIZATION.md](./solution-design/CODEBASE_REORGANIZATION.md)** — target layers, folder tree, cleanup phases |
| **Surface status** | [architecture/SURFACE_STATUS.md](../architecture/SURFACE_STATUS.md) | Active vs legacy surfaces |
| **Verify catalog** | [testing/VERIFY_SCRIPT_CATALOG.md](../testing/VERIFY_SCRIPT_CATALOG.md) | All deploy gate scripts |

### Front-desk production (callsomo.com)

- **Deploy + smoke:** **[deployment/FRONT_DESK_PRODUCTION.md](./deployment/FRONT_DESK_PRODUCTION.md)** — Cloud Run API, Firebase UI, Retell/Twilio, DNS order.


> **📌 Source of Truth**: This `docs/` folder is the canonical documentation for the platform. All `.md` files belong in `docs/` (or `todos/` for active/archive task tracking).  
> **Overlapping topics:** start with **[meta/CANONICAL_DOC_MAP.md](./meta/CANONICAL_DOC_MAP.md)** so you do not maintain the same story in two places.
>
> **Doc count policy (June 2026):** Each `docs/<folder>/` keeps at most **two** markdown files (`README.md` + one companion). Retired paths are listed in [`_consolidated_path_redirects.json`](./_consolidated_path_redirects.json). Regenerate merges: `node scripts/consolidate-docs-two-per-folder.cjs`.

### Consumer brand (Somo)

- **Single source of truth:** **[SOMO_GUIDELINES.md](./Brand/SOMO_GUIDELINES.md)** — naming, tokens, typography.
- **Logo / favicon / email HTML:** **[LOGO_AND_ICON_SSOT.md](./Brand/LOGO_AND_ICON_SSOT.md)**
- **Index:** **[Brand folder README](./Brand/README.md)**
- **Doc hygiene (what to read first):** **[meta/ENGINEERING_DOC_HYGIENE.md](./meta/ENGINEERING_DOC_HYGIENE.md)**

### Documentation placement policy (April 2026)

- Canonical docs: `docs/`
- Task tracking only: `todos/pending` and `todos/archive`
- Non-canonical root exceptions: `README.md`, `CONTRIBUTING.md`
- Archived legacy docs pointer: `docs/repo-migrated/README.md`

### For new developers

1. Read **root `CONTRIBUTING.md` (`../CONTRIBUTING.md`)** — PR checklist and commands that mirror CI.
2. Follow **[Setup Guide](./setup/README.md#getting-started-setup)** and copy env files from `middleware-platform/.env.example` / `patient-app/.env.example`.
3. Voice / commerce LLM env and debug flags (`KELLY_*`): **[KELLY_ENV_AND_DEBUG.md](./development/README.md#kelly-env-and-debug)**.
4. What CI actually runs vs deploy: **[Deployment (GCP Source of Truth)](./deployment/README.md)**.
5. Code layout: **[CODE_STRUCTURE.md](./development/README.md#guides-code-structure)**.
6. Staging-only product checks (quote parity, chat → pay): **[STAGING_PRODUCT_VERIFICATION.md](./testing/README.md#staging-product-verification)**.
7. Architecture decisions (ADRs): **[architecture/decisions/README.md](./architecture/README.md#decisions-readme)**.
8. Agentic checkout file map: **[AGENTIC_CHECKOUT_FILE_MAP.md](./architecture/README.md#commerce-agentic-checkout-file-map)**.
9. `server.js` decomposition & route ownership: **[SERVER_DECOMPOSITION.md](./architecture/SERVER_DECOMPOSITION.md)**, **[RUNTIME_ENTRYPOINTS_AND_ROUTE_OWNERSHIP.md](./architecture/RUNTIME_ENTRYPOINTS_AND_ROUTE_OWNERSHIP.md)**.
10. `server.js` refactor policy (new routes only in `routes/`): **[SERVER_JS_REFACTOR_POLICY.md](./development/README.md#server-js-refactor-policy)**.
11. Quarterly maintenance checklist: **[PERIODIC_MAINTENANCE.md](./development/README.md#periodic-maintenance)**.
12. Secret scanning expectations: **[Security docs](./security/README.md)**.
13. Browser E2E status: **[E2E_STATUS.md](./testing/README.md#e2e-status)**; funnel API smoke: `cd middleware-platform && npm run test:e2e-funnel` (server on :4000).
14. Batch line-level docs gap tracker: **[meta gap tracker section](./meta/README.md#codebase-batch-review-and-documentation-gaps)**.

---

## 📊 Documentation Audit (April 9, 2026)

- **Total .md files (repo, excluding `node_modules` / `.venv`):** ~249 — run `find . -name '*.md' -not -path '*/node_modules/*'` for current count. Historical note: 142 was cited after Phases 1–5 consolidation.
- **Consolidation plan:** [meta/DOCUMENTATION_AUDIT_AND_CONSOLIDATION_PLAN.md](./meta/README.md#documentation-audit-and-consolidation-plan)
- **Phase 1 & 2 applied:** Empty file + placeholder folders removed. Active gap work: [meta/GAP_ANALYSIS_RICHER_TRIAGE_AND_RECORDS.md](./meta/README.md#gap-analysis-richer-triage-and-records) and [`../todos/PENDING.md`](../todos/PENDING.md).

---

## 📚 Quick Navigation

### 🚀 Getting Started
- **[Setup Guide](./setup/README.md#getting-started-setup)** - Initial platform setup
- **[Deployment Guide](./deployment/README.md#guides-deployment-guide)** - Production deployment
- **[API Documentation](./api/README.md#api-documentation)** - API reference

### 📖 Core Documentation

#### DevOps source of truth (GCP-only)
- **[Deployment archive](./deployment/README.md)** — historical bulk (3.7k lines; search only)
- **[Live deploy & staging](./deployment/OPERATIONS.md)** — Cloud Run, landing, staging cron, Retell inventory
- **[Live runbooks](./runbooks/OPERATIONS.md)** — cutover, rollback, monitoring, payor/voice incidents
- **[Runbooks index](./runbooks/README.md)** — TOC for merged incident archive

#### Documentation health and gap tracking
- **[Canonical map](./meta/CANONICAL_DOC_MAP.md)** — one doc per topic
- **[Meta README](./meta/README.md)** — hygiene, staging profile, gap tracker anchors

#### Somo demo (production API + outbound)
- **[Agent index](./agent/README.md)** — Somo demo vs Kelly
- **[Somo demo reference](./agent/somo-demo/README.md)** — architecture, ADRs, templates
- **[Somo demo runbook](./agent/somo-demo/RUNBOOK.md)** — local dev, Phase A prod gates, outbound sales
- Backlog: [`../todos/PENDING.md`](../todos/PENDING.md)

#### Marketing landing (Somo)
- **[Somo landing](./deployment/OPERATIONS.md#somo-landing)** — build, hosts, demo API
- **[Image 1 marketing colors](./design/SOMO_MARKETING_COLORS.md)** — lizard / MSU / grass palette
- **[Hero layout](./deployment/OPERATIONS.md#somo-landing-hero)** — nav, copy, breakpoints

#### Database and voice foundation (2026)
- **[Database index](./Database/README.md)** — SSOT, migrations
- **[Database operations](./Database/OPERATIONS.md)** — foundation runbook, tenant model, env
- **[Voice inbound troubleshooting](./runbooks/OPERATIONS.md#voice-inbound-troubleshooting)**

#### Architecture
- **[Kelly agentic rails (build plan)](./architecture/KELLY_AGENTIC_RAILS_TARGET_AND_BUILD_PLAN.md)** — LangGraph-first roadmap
- **[Kelly rails v2 as-built](./architecture/kelly_rails_v2_as_built.md)** — `kelly-rails/` orchestrator SSOT
- **[Patient Timeline & billing (mobile + APIs)](./architecture/patients/PATIENT_TIMELINE_ROUTINE_AND_BILLING.md)** — Expo tabs, routine APIs, `calendar-range`, billing events, SQLite vs Postgres scope
- **[`server.js` decomposition (phase 6+)](./architecture/SERVER_DECOMPOSITION.md)** — extracted `routes/patient-*`, Kelly triage service, landing assistant, checkout-chat, admin/voice; ~11k lines remain in compose entry
- **[Runtime entrypoints & route ownership](./architecture/RUNTIME_ENTRYPOINTS_AND_ROUTE_OWNERSHIP.md)** — what mounts where on port 4000
- **[Architecture decisions (ADRs)](./architecture/README.md#decisions-readme)** — SQLite, voice/commerce LLM, agentic checkout surfaces
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
- **[Runtime entrypoints & route ownership](./architecture/RUNTIME_ENTRYPOINTS_AND_ROUTE_OWNERSHIP.md)** — compose entry, `routes/`, static SPA mounts (`bootstrap/static-hosting.js`)
- **[Code Ownership By Surface](./development/README.md#consolidated-code_ownership_by_surfacemd)** - Where to change what
- **[Scripts Operations Map](./development/README.md#consolidated-scripts_operations_mapmd)** - Script risk tiers and execution map
- **[Reliability Guide](./development/README.md#guides-reliability)** - Reliability patterns
- **[Template Variables](./development/README.md#templates)** - Automation email/SMS template variables
- **[GitHub Tasks](./development/README.md#github-tasks)** - Repo structure, branch hygiene
- **[Master TODO](./development/README.md#master-todo-full)** - Full platform roadmap

#### Admin Portal
- **[Admin Portal — Operator CRM](./admin-portal/README.md)** - 4-page CRM (control board, pipeline, lead detail, tenants)
- **[Admin route smoke test](./admin-portal/README.md#admin-portal-testing)** - `test-admin-routes.js` and local dev

#### API & Integrations
- **[API Reference](./api/README.md#api-documentation)** - Complete API documentation
- **[Medicaid provider directory (public search)](./Payor/PROVIDER_DIRECTORY_PIPELINE_AND_PUBLIC_SEARCH.md)** - pipeline + `/api/public/providers/*`
- **[Invoice API](./api/README.md#invoice-api)** - Invoice endpoints
- **[Stedi Integration](./integrations/README.md#stedi-api-stedi-api-endpoints)** - Stedi API
- **[UHC FHIR Integration](./integrations/README.md#uhc-fhir-uhc-fhir-service-usage)** - UHC FHIR
- **[Stripe Issuing](./integrations/README.md#stripe-issuing-stripe-issuing)** - Stripe cards

#### Setup & Configuration
- **[Main Setup](./setup/README.md#getting-started-setup)** - Platform setup
- **[Environment variables by surface](./setup/ENVIRONMENT_VARIABLES_BY_SURFACE.md)** - middleware, landing, Playwright, CI
- **[Stripe Issuing Setup](./integrations/README.md#stripe-issuing-stripe-issuing)** - Stripe configuration
- **[Google OAuth](./setup/README.md#google-google-oauth-complete-guide)** - Google Calendar OAuth
- **GCP configuration** - see [Deployment (GCP Source of Truth)](./deployment/README.md)

#### Deployment
- **[Deployment Guide](./deployment/README.md)** - Main GCP deployment guide
- **[DNS Configuration](./deployment/README.md#dns-ionos-ionos-dns-setup)** - DNS setup
- **[SSL Setup](./deployment/OPERATIONS.md#gcp-somo-service-cutover)** - SSL and domain mapping on current production stack
- **[Security](./deployment/README.md#security-production-deployment-api-keys)** - Security setup
- **[Database Migration](./deployment/README.md#database-postgres-migration)** - Postgres migration

#### User Guides
- **Invoice Workflow (`./user-guides/INVOICE_WORKFLOW.md`)** - Invoice generation workflow
- **[Clinic Onboarding](./onboarding/README.md#clinic-onboarding-checklist)** - Clinic setup

#### Patient booking, triage & agentic commerce
- **[Richer Triage & Records](./meta/README.md#gap-analysis-richer-triage-and-records)** — Schema, records Q&A
- **[Public agentic checkout](./architecture/README.md#commerce-public-agentic-checkout)** — Landing → quote → pay, commerce tools, APIs
- **Open work:** [`../todos/PENDING.md`](../todos/PENDING.md) — consolidated checklist (checkout deferred section)

#### Voice Agent, Video Consult & Medical Coding
- **[Medical Coding (canonical)](./Medical%20Coding/README.md)** — Architecture, operations, eval (start here for codebook/RAG)
- **[Hybrid Architecture Overview](./architecture/README.md#overview-hybrid-architecture-overview)** - Voice vs Video vs PDF, shared RAG/codes, boundaries
- **[Video Consult](./architecture/README.md#care-delivery-video-consult)** - LiveKit video: flow, env, runbook
- **[Landing Try now & LiveKit](./architecture/README.md#experience-landing-try-now-livekit)** - Skin & Care landing camera-first UI, `try-landing-*` rooms, voice LLM vs LiveKit
- **[Voice Agent Config](./voice-agent/README.md)** - Voice agent setup
- **[Medical Coding Runbook (legacy anchor)](./architecture/README.md#voice-agent-runbook)** - Points to canonical docs; partial freshness
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
- **Generate invoices** → Invoice Workflow (`./user-guides/INVOICE_WORKFLOW.md`)
- **Set up GCP deploy flow** → [Deployment Guide](./deployment/README.md)
- **Configure DNS** → [DNS Configuration](./deployment/README.md#dns-ionos-ionos-dns-setup)
- **Work on the Admin Portal** → [Admin Portal docs](./admin-portal/README.md)
- [`docs/deployment/FRONT_DESK_PRODUCTION.md`](./deployment/FRONT_DESK_PRODUCTION.md) — front-desk production surfaces

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
- [Deployment + rollback operations](./deployment/README.md)

### Healthcare
- [Healthcare Assessment](./architecture/README.md#healthcare-healthcare-assessment)
- [UHC FHIR Integration](./integrations/README.md#uhc-fhir-uhc-fhir-service-usage)
- [Stedi Integration](./integrations/README.md#stedi-api-stedi-api-endpoints)

### Voice Agent & Medical Coding
- [Medical Coding (canonical)](./Medical%20Coding/README.md)
- [Voice Agent Config](./voice-agent/README.md)
- [Video Consult](./architecture/README.md#care-delivery-video-consult)
- [Landing Try now & LiveKit](./architecture/README.md#experience-landing-try-now-livekit)
- [Medical Coding Runbook (legacy)](./architecture/README.md#voice-agent-runbook)
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
