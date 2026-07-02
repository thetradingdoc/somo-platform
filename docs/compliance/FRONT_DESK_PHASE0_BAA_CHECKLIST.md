# Front Desk Phase 0 — HIPAA BAA Checklist

**Scope:** NYC dental/medical front desk agent (Kelly voice, SMS, eligibility, provider portal).  
**Last updated:** 2026-06-30

## Before production PHI

Complete every row below. Store signed BAAs in your compliance vault (not in git).

| Vendor | Role | PHI exposure | BAA required | Status | Signed date | Notes |
|--------|------|--------------|--------------|--------|-------------|-------|
| **Retell AI** | Voice agent runtime, call audio/transcripts | High — voice calls, caller demographics | Yes | ☑ | | Primary voice stack — signed |
| **Twilio** | PSTN, SMS, phone numbers | High — call metadata, SMS content | Yes | ☑ | | Account-level BAA — signed |
| **Stedi** | Eligibility / clearinghouse | Medium — member ID, DOB, payer | Yes | ☐ | | 270/271 payloads — pending |
| **Stripe** | SaaS subscription + patient copay links | Low–Medium — billing contact, payment metadata | Yes | ☐ | | Stripe BAA for healthcare |
| **Google Cloud (GCP)** | App hosting, Cloud SQL/SQLite backups, logs | High — all application PHI at rest/in transit | Yes | ☐ | | Firebase if used for auth |
| **Groq** | LLM inference (if routed) | High — call context in prompts | Yes | ☐ | | Or Anthropic/OpenAI per routing |
| **Anthropic** | LLM inference (if routed) | High — call context in prompts | Yes | ☐ | | |
| **OpenAI** | LLM inference (if routed) | High — call context in prompts | Yes | ☐ | | |

## Technical guardrails (code + ops)

| Control | Implementation | Verify |
|---------|----------------|--------|
| PHI access audit log | `hipaa_access_log` table + `db.logHipaaAccess()` | `npm run verify:phase0-front-desk` |
| FHIR API JWT in prod | `REQUIRE_JWT_FOR_FHIR=1` | `npm run verify:env-gates` |
| BAA acknowledgment | `BAA_ACKNOWLEDGED=1` in production | `npm run verify:env-gates` |
| Provider case report auth | `requireCustomerAuth` on `/api/patient/:id/case-report` | Integration test / manual |
| Voice vendor keys in prod | `RETELL_API_KEY`, `TWILIO_*` set | `npm run verify:env-gates` |
| No shadow routing in prod | `CONVERSATION_MODE_ROUTING` ≠ `shadow` | `npm run verify:env-gates` |
| Admin API secret in prod | `ADMIN_PORTAL_SECRET` set | `npm run verify:env-gates` |

## Customer BAA (per dental/medical office)

Use template: [`templates/CUSTOMER_BAA_TEMPLATE.md`](./templates/CUSTOMER_BAA_TEMPLATE.md)  
Pair with: [`templates/MSA_SERVICES_AGREEMENT_TEMPLATE.md`](./templates/MSA_SERVICES_AGREEMENT_TEMPLATE.md)

## Pricing decisions (locked for pilot)

- Kelly voice hours: [`FRONT_DESK_COVERAGE_PRICING_DECISION.md`](./FRONT_DESK_COVERAGE_PRICING_DECISION.md)
- Eligibility hybrid: [`FRONT_DESK_ELIGIBILITY_PRICING_DECISION.md`](./FRONT_DESK_ELIGIBILITY_PRICING_DECISION.md)

## Offboarding

Runbook: [`docs/runbooks/TENANT_OFFBOARDING.md`](../runbooks/TENANT_OFFBOARDING.md)  
API: `GET /api/admin/tenants/:clinicId/phi-export`

## Production environment variables

```bash
# HIPAA / compliance
BAA_ACKNOWLEDGED=1
REQUIRE_JWT_FOR_FHIR=1

# Voice stack
RETELL_API_KEY=...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...

# Billing (subscription = agent credits)
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...

# Admin API
ADMIN_PORTAL_SECRET=...

# Profile
CLOUDRUN_PROFILE=production
```

## Related docs

- Telemedicine BAA checklist (legacy): [compliance README — BAA section](./README.md#baa-compliance-checklist)
- Plan catalog / credits SSOT: `middleware-platform/config/plan-catalog.json`
- Risk assessment template: `docs/compliance/templates/HIPAA_RISK_ASSESSMENT_CHECKLIST.md`
- Automated checks: `middleware-platform/scripts/verify-phase0-front-desk.cjs`
