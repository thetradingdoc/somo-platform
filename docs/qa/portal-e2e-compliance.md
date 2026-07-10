# Portal E2E — compliance sign-off (production Somo tenant)

**Purpose:** Approval for automated Playwright tests that may create **synthetic** patient-like rows in the production Somo demo/pilot tenant.

## Policy

| Item | Rule |
|------|------|
| Patient data | **Synthetic only** — fake names prefixed `[E2E]`, fake phone numbers, no real PHI |
| Persisted writes | Tag `e2e_source=playwright` in notes/metadata when a write is unavoidable |
| Prod P1 default | **Read-only** — open UI, cancel without save |
| Retention | Weekly cleanup (`portal-e2e-cleanup-somo.cjs`) removes tagged rows older than 7 days |
| Execution | Prod `reuse` from **GitHub Actions** only; prod `create` manual with approval |
| Credentials | `PW_SOMO_PROD_EMAIL` / `PW_SOMO_PROD_PASS` in GitHub Secrets — never in repo |

## Platform line (+13639990205)

| Item | Rule |
|------|------|
| Call type | Business / sales / tenant support — **not** clinical PHI |
| Recording | Retell + Twilio recording may apply; opener discloses recording (platform-support rail) |
| Retention | Same as operator voice_call_log retention policy; no patient chart linkage |

## Sign-off (tenant E2E — blocked)

| Field | Value |
|-------|-------|
| Approved by | Richard Ojrichard (`richard@callsomo.com`) |
| Date | 2026-07-04 |
| Scope | Portal E2E P0/P1 — **prod-create / 862 DID blocked** until real practice tenant exists |
| Notes | Synthetic test data only; doclittle archived; Somo provision pending `PW_MODE=create` |

## Phase 1 cleanup executed

- **2026-07-04:** 6 junk customers deleted; `clinic-doclittle` soft-archived via `admin-tenant-delete-service`
- **Snapshot backup:** `backups/middleware-staging.pre-cleanup-2026-07-04T17-38-36.db`
- **GCS upload:** `gs://somo-staging-db-somo-callsomo/middleware-staging.db`
- **Remaining customers:** operator, navigation-demo, doclittle (until Somo replaces)

## Related

- Runner: `npm run portal-e2e:run --prefix middleware-platform`
- Cleanup: `npm run portal-e2e:cleanup --prefix middleware-platform`
- Plan: `.cursor/plans/staging_portal_ux_audit_aae03841.plan.md`
