# Payor Scoring Policy Rollback

## Scope
- Roll back from a bad Step 5 scoring policy version while preserving auditability.

## Trigger Conditions
- Unexpected spike in `merge_review_flag`/`auto_merge`.
- Increased false-merge correction rate in review feedback outcomes.
- Operator report from review queue quality checks.

## Rollback Procedure
- Select previous stable policy version (example: `v1`).
- Re-run Step 5 with rollback policy:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/run-payor-resolution-decisions.cjs --policy-version=v1 --policy-profile=default --limit=200000`
- Re-run Step 6 using same policy scope:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/run-payor-canonicalization.cjs --policy-version=v1 --limit=200000`
- Re-sync Step 7 review queue:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/run-payor-review-feedback-loop.cjs --policy-version=v1 --sync-queue`

## Verification
- Run:
  - `DB_PATH=./middleware-dev.db node middleware-platform/scripts/report-payor-observability-ops.cjs --policy-version=v1`
- Confirm:
  - decision distribution is back in expected range
  - review queue volume is manageable
  - false-merge correction rate drops from bad policy baseline

## Audit Notes
- Keep both old and new policy versions in `payor_resolution_policies`.
- Do not delete old decision rows; compare by `policy_version`.

