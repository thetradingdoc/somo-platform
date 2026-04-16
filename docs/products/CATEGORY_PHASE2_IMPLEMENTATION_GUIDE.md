# Category Phase 2 Implementation Guide

## Lane Separation Rules

- `real_category` -> taxonomy map only.
- `alias_translation` -> alias file only (narrow deterministic canonicalization).
- `meta_noise` -> suppression list only.
- `manual_review` -> review queue only.

**Important:** `alias_translation` must not become a dumping ground for meta/noise tags.

## Required Command Order (Frozen Measurement)

1. Freeze baseline:
   - `npm run catalog:phase2:baseline:freeze`
2. Generate backlog + triage template:
   - `npm run catalog:unknown:backlog`
   - `npm run catalog:backlog:triage-template`
3. Prepare a limited approved batch (25-50):
   - `npm run catalog:batch:prepare -- --batch-id <id> --limit 50`
4. Run gates:
   - `npm run catalog:golden:diff`
   - `npm run test:session-orchestration` (or equivalent)
   - `npm run catalog:rollout:check`
5. Generate postdeploy-style comparison:
   - `npm run catalog:postdeploy:report`

## Plateau / Stop Criteria

- Stop map expansion when unknown reduction per batch is below threshold for two consecutive batches.
- Stop and investigate if route-shift guard fails or repeatedly nears threshold.

## Ownership and Auditability

- Every batch requires:
  - DRI
  - reviewer
  - batch changelog
  - linked evidence artifacts

Use:

- `docs/products/CATEGORY_PHASE2_BATCH_CHANGELOG_TEMPLATE.md`
