# Patient Portal & Telehealth — Consolidated Todo

**Last Updated:** March 2026

Merged from: PATIENT_WEB_PORTAL_TODO, TELEHEALTH_MVP_TODOS, LITTLELAB_LANDING_AND_SIGNUP_TODO.

---

## 1. Telehealth MVP Status

**P0/P1/P2:** Most items ✅ Done (login, appointments, video, payment, records, security, etc.)

**Remaining production blockers:**
- **mvp-64**: Soft delete across patient entities
- **mvp-65**: Immutable audit trail for patient-sensitive events
- **mvp-66**: PHI protection audit checklist (scrub logs, no PHI in URLs)
- **mvp-70**: Document retention policy + export on request

---

## 2. Portal Hardening (PATIENT_WEB_PORTAL_TODO)

| Area | Task |
|------|------|
| **Identity** | Document `patient_portal_sessions` lifecycle; persist IP/UA; soft lock after N failed attempts |
| **Security** | Threat model; antivirus/content scanning on uploads |
| **Resilience** | `showPatientAlert` on all pages; LiveKit-down fallback; payment-processor-down behavior |
| **Observability** | Propagate `journey_id` end-to-end; metrics for login, onboarding, video, case-report |
| **Feature flags** | Gate case-report behind `FEATURE_PATIENT_CASE_REPORT`; per-clinic overrides |
| **Testing** | Jest for mergePatients, verifyCode, completePaymentSuccess; Playwright E2E |
| **Performance** | Load tests (k6); Lighthouse optimizations |

---

## 3. LittleLab Landing & Signup

| Task | Notes |
|------|-------|
| RAG search endpoint | `GET /api/rag/search?q=` → getCodeCandidatesDualSource |
| 3D React landing | Data-driven cards, useRAGSearch hook, RoleSelect (Patient/Provider) |
| Brand DocLittle → LittleLab | Titles, logo in landing + patient pages |
| Patient entry | `/` lands on LittleLab 3D search; "I'm a Patient" → patient-login |

---

## 4. Related

- [PATIENT_ARCHITECTURE.md](./PATIENT_ARCHITECTURE.md) — Flow, session, UI
- [LOCAL_TEST_RUNBOOK.md](./LOCAL_TEST_RUNBOOK.md) — Local E2E
