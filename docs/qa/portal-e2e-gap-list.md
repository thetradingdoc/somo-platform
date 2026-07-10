# Portal E2E — gap list (2026-07-04)

## Closed this sprint

- GCS snapshot pull + Phase 1 cleanup (6 junk deleted, doclittle archived)
- Deploy SHA gate green (`5301ba8` on `00156-h44`)
- Stripe test mode verified
- Checkpoint state machine, history JSONL, P1 manifest, CI workflow
- Parity table + trend reporting scaffold

## Open — blocks pilot

| Gap | Severity | Owner action |
|-----|----------|--------------|
| **Somo tenant not provisioned** | P0 | Run prod `PW_MODE=create` via Playwright (`portal-e2e-run.cjs --step=prod-create`) with `TRIAL_E2E_PHONE` + OTP source |
| **DID still doclittle** | P0 | After Somo create: `portal-e2e-somo-bind.cjs` + `did-verify` |
| **Prod reuse creds not in CI** | P0 | Add `PW_SOMO_PROD_EMAIL` / `PW_SOMO_PROD_PASS` to GitHub Secrets |
| **PSTN manual smoke** | P1 | Complete checklist after DID bind |

## Open — staging/local depth

| Gap | Severity | Notes |
|-----|----------|-------|
| Full voice-setup wizard in portal spec | ~~P1~~ closed | Wired in `portal-journey-auth.cjs` + `dentist-journey-parity.spec.cjs` — needs `TRIAL_E2E_PHONE` to exercise |
| Authenticated P0 without `TRIAL_E2E_PHONE` | P2 | Set `TRIAL_E2E_PHONE` + `STAGING_DB_PATH` for OTP |
| Onboarding P0 row in parity | ~~P2~~ closed | Recorded as `onboarding` P0 in auth test |

## Open — ops

| Gap | Severity | Notes |
|-----|----------|-------|
| Twilio `statusCallback` unset on `+18623622415` | P2 | Set during `callsomo-operator-sync` on bind |
| Post-deploy workflow trigger | P2 | Currently on push to portal-e2e paths + nightly; tie to deploy workflow when ready |
| Feature inventory screenshots | P3 | Post-run deliverable |

## Parity snapshot (latest staging)

| Control | Staging |
|---------|---------|
| api_health | pass |
| landing | pass |
| auth | pass |
| today_dashboard | skip (no session) |
| kelly_pause_transfer | skip |
| session_auth | skip |
| kill_switch | skip |
| logout_login_redirect | skip |

**Prod-only P0 failures:** 0 (no prod run yet)
