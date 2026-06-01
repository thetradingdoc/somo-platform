# RCM end-to-end test flow

This document describes how to verify the full 11-stage revenue cycle (provider portal, patient wallet, Stedi eligibility, and payment rails).

## Environment checklist

### Stedi (Phase 1 gate)

```bash
cd middleware-platform
node scripts/stedi-test-mode-probe.cjs   # copy recommendedEnv into .env
node scripts/stedi-sandbox-integration.cjs   # 270/271 must PASS (no stediFallback)
```

Required variables (see also `docs/RCM/STEDI_PA_WORKSTREAM.md`):

| Variable | Purpose |
|----------|---------|
| `STEDI_API_KEY` | Stedi Healthcare API key (`test_` for sandbox) |
| `STEDI_TEST_MODE=1` | Force sandbox test identity |
| `STEDI_TEST_PAYER_ID` | Trading partner id (e.g. `STEDI` or `60054`) |
| `STEDI_TEST_MEMBER_ID` | Sandbox member id |
| `STEDI_TEST_DOB` | `YYYY-MM-DD` matching Stedi test member |
| `STEDI_TEST_SUBSCRIBER_FIRST` / `STEDI_TEST_SUBSCRIBER_LAST` | Subscriber name |
| `STEDI_TEST_PROVIDER_NPI` | Provider NPI for eligibility |

Demo payer aliases (`UHC`, `BCBS`, `AETNA`) are mapped to `STEDI_TEST_PAYER_ID` in test mode. **Do not** send bare demo ids to Stedi in production.

AAA codes **79** (invalid participant) and **71** (DOB mismatch) appear in eligibility API responses as `aaa_codes` / `aaa_messages`.

### API E2E server profile

| Variable | Value |
|----------|--------|
| `DEV_LIGHT_START=1` | Skip heavy post-listen workers |
| `SKIP_STARTUP_MIGRATIONS=1` | Faster startup for local E2E |
| `FACE_READ_AUTO_START=0` | Avoid background face-read worker |
| `RCM_E2E_SKIP_GATES=1` | Optional gate bypass for scripts |

### Payment rails (optional live paths)

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` | Card on `patients/pay.html` |
| `RCM_E2E_STRIPE_LIVE=1` | Money path probes Stripe intent |
| `CIRCLE_*` + `RCM_E2E_USDC_LIVE=1` | USDC settlement path |
| `PUBLIC_PAY_BASE_URL` | Base URL for `/patients/pay.html?token=` links |
| `RCM_PAY_PROBE_CIRCLE_BALANCE=1` | Show USDC balance on pay page |

See also: [RCM_PATIENT_PAY_GATEWAY.md](./RCM_PATIENT_PAY_GATEWAY.md) (Kelly `request_patient_payment` flow).

## Automated test commands

```bash
cd middleware-platform
node scripts/stedi-sandbox-integration.cjs
npm run test:rcm
npm run test:e2e:rcm:all
npm run test:e2e:rcm:playwright
npm run test:e2e:rcm:pay-ui
```

Kelly agentic pay gateway (tool only — no conversation):

```bash
RCM_E2E_USE_EXISTING_SERVER=1 npm run test:e2e:rcm:pay-gateway
RCM_E2E_STRIPE_LIVE=1 RCM_E2E_USE_EXISTING_SERVER=1 npm run test:e2e:rcm:pay-gateway
```

Kelly **conversation** diagnostic (multi-turn `processTurn` — derm → book → copay → pay):

```bash
# Requires ANTHROPIC_API_KEY or GROQ_API_KEY
RCM_E2E_USE_EXISTING_SERVER=1 npm run test:e2e:rcm:conversation
RCM_E2E_STRIPE_LIVE=1 RCM_E2E_USE_EXISTING_SERVER=1 npm run test:e2e:rcm:conversation
```

See scorecard and failure categories in [RCM_PATIENT_PAY_GATEWAY.md](./RCM_PATIENT_PAY_GATEWAY.md#conversation-e2e--scorecard-interpretation-2026-05-31-run).

## Manual UI verification

### Provider

1. Log in at `/business/login.html` (demo: `provider@doclittle.com` / `demo123`).
2. **RCM Command Center** (`/business/rcm.html`) — stage labels, collection queue, recently paid.
3. **Patient Payments** (`/business/patient-payments.html`) — paid rows, journey stage labels, copy pay link.

### Patient

1. **Wallet** (`/patients/wallet.html`) — **Bills & claims** card shows status chips and pay link when due.
2. **Pay link** (`/patients/pay.html?token=…`) — card/USDC rails; Stripe `return_url` set for 3DS.

## 11-stage API golden path

Stages (orchestrator contract): pre_registration → registration → charge_capture → prior_authorization → medical_coding → cdi → claim_submission → remittance_processing → follow_up_phone → patient_collection → bill.

`scripts/e2e-rcm-golden-path.cjs` advances each stage via:

- `POST /api/rcm/journeys/start`
- `POST /api/rcm/journeys/:id/events` with `stage_to`
- `PATCH /api/rcm/journeys/:id` (close)

## Money path

`scripts/rcm-e2e-money-path.cjs`:

1. `POST /api/rcm/payments/request` → `pay_token`, `pay_url`
2. Default: `POST /api/rcm/payments/:id/mark-paid`
3. Optional: public pay USDC/Stripe when live env flags set

## Stedi success criteria

In the Stedi dashboard, eligibility for the configured test member should show **Succeeded**, not **Failed 79/71**, after env + payer mapping fixes.

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Failed **79** | Wrong `tradingPartnerServiceId` (demo payer id sent raw) |
| Failed **71** | DOB mismatch — use FHIR `birthDate` or `STEDI_TEST_DOB` |
| Registration gate | No `eligibility_checks` row — run eligibility or E2E `skip_gates` |
| Login timeout on E2E | Start server with `DEV_LIGHT_START=1` |
