# Documentation Cleanup – March 2026

Summary of doc consolidation, link fixes, and todo organization.

---

## Link fixes

| Broken link | Fixed to |
|-------------|----------|
| `SUBDOMAIN_SSL_FIX.md` | `TENANT_AND_DNS_SETUP.md` |
| `STRIPE_ISSUING_STATUS.md` | `STRIPE_ISSUING.md` |
| `TECH_LEAD_CLEANUP` (development/) | `archive/TECH_LEAD_CLEANUP.md` |
| `FIXES_APPLIED` (maintenance/) | `archive/FIXES_APPLIED.md` |
| `ADMIN_PORTAL_FIXES_COMPLETE` | `archive/ADMIN_PORTAL_FIXES_COMPLETE.md` |

**Files updated:** `pending/PRODUCTION_READINESS_TASKS.md`, `DEPLOYMENT_GUIDE.md`, `AUTOMATED_TENANT_DOMAIN_SETUP.md`, `docs/README.md`, `architecture/README.md`, `admin-portal/*.md`, `todos/README.md`.

---

## Archived docs

Moved to `docs/archive/`:

- **ADMIN_PORTAL_FIXES_COMPLETE.md** — Admin portal fixes (Dec 2025)
- **FIXES_APPLIED.md** — Architecture Phase 1–2 fixes (Jan 2025)
- **TECH_LEAD_CLEANUP.md** — Video Consult + LangSmith consolidation (Feb 2026)

---

## Todo layout

| Location | Contents |
|----------|----------|
| **todos/** | Active operational checklists; **completed** lists under `todos/archive/` (e.g. triage phased roadmap, agentic checkout UI spec) |
| **docs/development/** | `MASTER_TODO_FULL.md` (platform roadmap) |
| **docs/architecture/** | Domain-specific TODOs: `VOICE_AGENT_TODO_AND_STATUS`, `TIBA_AND_BILLING_TODO`, `PATIENT_PORTAL_AND_TELEHEALTH_TODO` |
| **docs/** | Gap/analysis: `GAP_ANALYSIS_RICHER_TRIAGE_AND_RECORDS`, `PATIENT_BOOKING_AND_TRIAGE_GAPS` |

**todos/README.md** lists all task docs and links to related docs for context.

---

## Folder structure (high level)

- **todos/** — Actionable checklists and task lists
- **docs/** — Architecture, how-tos, references; domain TODOs live in their domain folders
- **docs/archive/** — Historical fix summaries and old debug scripts
