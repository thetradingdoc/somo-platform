# Production vendor gates

> **Last updated:** 2026-07-02  
> **Purpose:** Engineering runbook for the 7 vendor-blocked todos in the provider portal production plan.  
> **Scope:** Automation + skip-safe checks only — **no live Stedi 271 or Dentrix prod cutover without credentials and BAA.**

## Quick check (dev-safe)

```bash
cd middleware-platform
npm run verify:prod-gates
```

Exits **0** in dev (informational warnings). Set `PILOT_PROD_STRICT=1` to fail on missing prod config.

Also wired into `npm run verify:front-desk-pilot` as an informational subsection unless `PILOT_PROD_STRICT=1`.

---

## Pending todos

| Todo ID | Owner | Blocker | When unblocked |
|---------|-------|---------|----------------|
| `fd2-prod-stedi` | Eng + Finance | Stedi prod API key funded | `setup:phase2-prod-stedi --apply` |
| `fd2-stedi-baa-enrollment` | Legal + Vendor | Stedi BAA signed, NPI enrolled | Manual enrollment portal |
| `fd-prod-stedi-cloudrun` | Eng | Prod key in Secret Manager | gcloud env update (see script output) |
| `fd2-dxc-fallback-live` | Eng | DXC adapter contract (optional) | Set `DXC_FALLBACK_TRIGGER_PCT`; wire adapter |
| `fd3-henry-schein` | Legal + Vendor | API Exchange application approved | Set `HENRY_SCHEIN_APPLICATION_SUBMITTED=1` |
| `fd3-dentrix` | Eng + Vendor | Sandbox `client_id` / `client_secret` | `.env` + `discover:dentrix-sandbox` |
| `fd3-dentrix-e2e-sandbox` | Eng | Dentrix creds + org/location IDs | `npm run verify:phase3-dentrix` |

---

## Stedi cluster (5 todos)

### Prerequisites

- [ ] Stedi **production** pay-as-you-go account funded
- [ ] BAA signed — see `docs/compliance/FRONT_DESK_PHASE0_BAA_CHECKLIST.md`
- [ ] Pilot NPI + top payers enrolled in Stedi Transaction Enrollment
- [ ] **Do not run live 271 until BAA is signed and NPI is enrolled**

### Commands

```bash
cd middleware-platform

# Checklist + local env mapping (no gcloud)
npm run setup:phase2-prod-stedi -- --check-only

# Full dry-run with gcloud hint
npm run setup:phase2-prod-stedi

# After prod key in Secret Manager — print Cloud Run update (manual copy/paste)
npm run setup:phase2-prod-stedi -- --apply

# Shadow week + go-live (clinic-scoped)
npm run setup:phase2-shadow -- --clinic-id <clinic_id>
npm run setup:pilot-go-live -- --clinic-id <clinic_id>

# Live ops verification (prod only, after cutover)
npm run verify:phase2-ops -- --clinic-id <clinic_id>
PILOT_PROD_STRICT=1 npm run verify:pilot-prod-readiness
```

### Guardrails

- Keep `STEDI_TEST_MODE=1` and `VOICE_ELIGIBILITY_SIMULATE=1` in dev/staging
- Set `STEDI_TEST_MODE=0` and `VOICE_ELIGIBILITY_SIMULATE=0` **only** on production Cloud Run after BAA + enrollment
- `verify:phase3-dentrix-sandbox.cjs` exits 0 when creds missing — safe in CI

---

## Dentrix / Henry Schein cluster (2 todos)

### Prerequisites

- [ ] Henry Schein API Exchange application submitted and approved
- [ ] Integration agreement signed; sandbox credentials received

### Commands

```bash
cd middleware-platform

# Application checklist + env status
npm run setup:henry-schein-application

# After approval — add to .env:
#   DENTRIX_CLIENT_ID=...
#   DENTRIX_CLIENT_SECRET=...
#   HENRY_SCHEIN_APPLICATION_SUBMITTED=1

npm run discover:dentrix-sandbox
npm run setup:phase3-dentrix-pilot -- --clinic-id <clinic_id>
npm run verify:phase3-dentrix
npm run verify:phase3-sandbox
```

---

## DXC fallback (informational)

Thin-271 fallback threshold: `DXC_FALLBACK_TRIGGER_PCT` (default 20).  
Real DentalXChange adapter is deferred until pilot thin-rate review — see `services/payer-gateway-fallback.js`.

---

## Related docs

- [Phase 2 pilot checklist](./phase2-pilot-checklist.md)
- [Phase 5 visual QA matrix](../design/PHASE5_VISUAL_QA_MATRIX.md)
- [Inventory completion matrix](../design/INVENTORY_COMPLETION_MATRIX.md)
