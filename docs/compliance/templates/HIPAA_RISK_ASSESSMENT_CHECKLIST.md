# HIPAA Security Risk Assessment — Front Desk Agent (Checklist)

**Scope:** NYC dental/medical Kelly front desk (voice, eligibility, provider portal).  
**Regulatory basis:** 45 CFR §164.308(a)(1)(ii)(A) — Security Management Process.  
**Version:** 1.0 — 2026-06-30

Complete annually and before production PHI processing. Store signed assessment in compliance vault (not in git).

## Executive sign-off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Security officer | | | |
| Privacy officer | | | |
| Engineering lead | | | |

---

## 1. Asset inventory

| Asset | Contains PHI | Owner | Location |
|-------|--------------|-------|----------|
| Cloud Run `somo-middleware` | Yes | Engineering | GCP `somo-callsomo` |
| SQLite / GCS DB backups | Yes | Engineering | GCS bucket |
| Retell (voice transcripts) | Yes | Engineering | Retell cloud |
| Twilio (call metadata, SMS) | Yes | Engineering | Twilio |
| Stedi (270/271) | Yes | Engineering | Stedi |
| Stripe (billing metadata) | Low | Finance | Stripe |
| LLM vendors (Groq/Anthropic/OpenAI) | Yes (prompt context) | Engineering | Per routing |

## 2. Threat / vulnerability review

| # | Area | Risk | Likelihood | Impact | Mitigation | Residual |
|---|------|------|------------|--------|------------|----------|
| 1 | Unauthorized API access | PHI exfiltration | M | H | JWT on FHIR (`REQUIRE_JWT_FOR_FHIR`), admin secret | |
| 2 | Cross-tenant data leak | Wrong patient context | L | H | Tenant scoping on voice + session; isolation test `fd3-phi-isolation-test` | |
| 3 | Vendor breach | PHI at subprocessors | M | H | Vendor BAAs; `BAA_ACKNOWLEDGED` prod gate | |
| 4 | Log leakage | PHI in application logs | M | M | Log redaction audit `fd6-log-redaction` | |
| 5 | Stolen admin credentials | Bulk PHI access | L | H | `ADMIN_PORTAL_SECRET`, capability gates | |
| 6 | Lost device / insider | Export abuse | L | M | HIPAA access log; offboarding export audit | |

## 3. Technical controls (verify)

| Control | Implementation | Verified |
|---------|----------------|----------|
| Access control | `requireCustomerAuth`, admin capabilities | ☐ |
| Audit controls | `hipaa_access_log`, `db.logHipaaAccess()` | ☐ |
| Integrity | Idempotent usage + payment keys | ☐ |
| Transmission security | TLS (Cloud Run, Twilio, Retell WSS) | ☐ |
| Encryption at rest | GCS bucket policies | ☐ |
| Env gates | `npm run verify:env-gates` | ☐ |
| Phase 0 structural | `npm run verify:phase0-front-desk` | ☐ |

## 4. Administrative safeguards

| Item | Status |
|------|--------|
| Workforce training on PHI handling | ☐ |
| Vendor BAA checklist complete | ☐ |
| Incident response playbook | ☐ |
| Offboarding / PHI export runbook | ☐ |
| BAAs with customers (template signed) | ☐ |

## 5. Conclusion

- [ ] Risks reduced to reasonable and appropriate level for pilot
- [ ] Remediation items assigned with due dates
- [ ] Next review scheduled: `[DATE + 12 months]`
