# Clean Push to GCP — TODOs

_Created: 2026-04-30_

Tracking rule:
- `[ ]` = pending
- `[x]` = completed

- [x] Lock release scope: confirm this push is only payor/provider/geo runtime + tests; exclude broad docs migration unless intentionally included.
- [x] Drop local artifacts: remove `middleware-platform/middleware-platform/:memory:` and prevent recreation as tracked content.
- [x] Remove workspace-only files from commit scope: exclude `*.code-workspace` files in docs/tests.
- [x] Classify untracked files: decide keep vs delete for each untracked script/test/doc.
- [x] Review destructive docs diffs: confirm all `docs/*` deletions are intentional; restore accidental removals.
- [x] Create final include list: exact file paths to stage for this release.
- [x] Verify `.gitignore` coverage: ensure temp/debug artifacts are ignored.
- [x] Run scoped QA gate: `npm run verify:payor-navigator:local`.
- [x] Run local HTTP smoke: `RUN_PAYOR_HTTP_SMOKE=1` payor-location smoke test.
- [x] Check prod parity output: run `check-prod-payor-route-parity` and capture route/schema gaps.
- [x] Prepare migration/deploy notes: document DB/schema prerequisites for GCP.
- [x] Review API contract changes: note `geo_version` on 400/422 and any new response fields.
- [x] Stage only approved files with explicit `git add <path>` (no broad adds).
- [x] Run staged diff review before commit (scope + secrets + artifacts).
- [x] Write focused commit message (why + impact).
- [ ] Verify post-commit cleanliness with `git status`.
- [ ] Choose deploy path: code push, hosting deploy, or both.
- [ ] Execute deploy with checklist and capture output.
- [ ] Run post-deploy smoke (`/health`, `/api`, payor/public routes, critical UI flow).
- [ ] Record rollback plan: prior commit SHA + rollback command.

## Summary

- Total TODOs: **20**
- Pending now: **5**
- Completed now: **15**

## Batch 1 output (completed)

- Scope locked for release commit: runtime payor/provider/geo code + supporting scripts/tests only.
- Deleted local artifact: `middleware-platform/middleware-platform/:memory:`.
- Deleted workspace-only files:
  - `docs/meta/doclittle-platform.code-workspace`
  - `middleware-platform/__tests__/doclittle-platform.code-workspace`
- Untracked classification:
  - Keep for release scope: payor/provider scripts, tests, `geo-normalize`, `PAYOR_SEARCH_TEST_GUIDE.md`, this TODO file.
  - Defer/non-release: broad docs migration files unless explicitly approved.
- Final include-list draft (release-target files):
  - `middleware-platform/routes/geo-diagnostics.js`
  - `middleware-platform/routes/public-geo.js`
  - `middleware-platform/routes/public-plan-search.js`
  - `middleware-platform/services/geo-resolver-service.js`
  - `middleware-platform/services/geo-normalize.js`
  - `middleware-platform/scripts/build-canonical-geo-from-legacy.cjs`
  - `middleware-platform/scripts/check-prod-payor-route-parity.cjs`
  - `middleware-platform/scripts/check-zip-crosswalk-row-count.cjs`
  - `middleware-platform/scripts/payor-us-location-preflight.cjs`
  - `middleware-platform/scripts/run-payor-us-location-pipeline.cjs`
  - `middleware-platform/scripts/run-payor-landscape-premium-ingest.cjs`
  - `middleware-platform/scripts/run-payor-pbp-benefits-ingest.cjs`
  - `middleware-platform/scripts/run-payor-service-area-ingest.cjs`
  - `middleware-platform/scripts/run-payor-zip-county-crosswalk-ingest.cjs`
  - `middleware-platform/scripts/verify-geo-diagnostics-post-ingest.cjs`
  - `middleware-platform/package.json`
  - `middleware-platform/PAYOR_SEARCH_TEST_GUIDE.md`
  - `middleware-platform/__tests__/geo-diagnostics-version-alignment.test.js`
  - `middleware-platform/__tests__/geo-resolver-county-normalization.test.js`
  - `middleware-platform/__tests__/payor-location-smoke.test.js`
  - `package.json`
  - `.gitignore`
  - `todos/pending/CLEAN_PUSH_GCP_TODOS.md`

## Batch 2 output (completed)

- Docs destructive-diff review completed (`git diff --name-status -- docs`):
  - Large README consolidation is present with many legacy doc deletions.
  - Action decision for release scope: **defer docs sweep from release commit** unless explicitly approved.
- `.gitignore` review completed:
  - Confirms coverage for temp/debug artifacts (`.tmp-*.png`, `e2e-debug-*.png`, db sidecars, `middleware-platform/:memory:` pattern).
- Scoped QA gate completed:
  - `npm run verify:payor-navigator:local` passed (middleware Jest + landing production build).
- Local HTTP smoke completed:
  - `RUN_PAYOR_HTTP_SMOKE=1 npx jest __tests__/payor-location-smoke.test.js --runInBand` passed (47/47).
- Prod parity check completed:
  - `node middleware-platform/scripts/check-prod-payor-route-parity.cjs`
  - Result: `/api/public/plans/search` and `/api/public/plans/meta` return 404 on current prod host (`issues`: `plans_search_route_missing`, `plans_meta_route_missing`).

## Batch 3 output (completed)

- Migration/deploy prerequisite notes prepared (GCP):
  - Deploy backend code that mounts:
    - `/api/public/plans/search`
    - `/api/public/plans/meta`
    - `/api/public/geo/options` + `/api/public/geo/health`
  - Ensure DB migrations/schema parity before traffic cutover:
    - run middleware migrations (`npm run migrate --prefix middleware-platform` on target env)
    - verify no schema drift (`no such column` errors) against prod routes
  - Geo dataset prerequisites:
    - run canonical build if needed: `npm run geo:build:canonical --prefix middleware-platform`
    - run readiness gate: `npm run geo:verify:release-readiness --prefix middleware-platform`
    - run crosswalk count check: `npm run geo:check:crosswalk-count --prefix middleware-platform`
  - Provider/payor preconditions (if enabling provider acceptance):
    - provider registry/link tables must be populated (`provider_registry_entities`, `provider_payer_networks`)
    - otherwise provider-registry search returns empty despite healthy endpoint.

- API contract review notes prepared:
  - `/api/public/plans/search` now returns `geo_version` on:
    - success responses
    - 400 validation errors
    - 422 structured errors (`zip_unmapped`, `location_scope_unavailable`)
  - `/api/public/plans/search` success payload now includes per-plan:
    - `state_abbr`
    - `county_name`
    (added for no-leakage validation and location transparency)
  - `/api/public/plans/meta` and geo endpoints include `geo_version`/geo diagnostics metadata.
  - Consumer impact:
    - clients parsing 400/422 bodies should tolerate and retain `geo_version`
    - clients can optionally render location transparency from new fields.

## Batch 4 output (completed)

- Staged only approved release files with explicit `git add` (no broad add).
- Staged diff review completed:
  - Staged set is scoped to release-target runtime/scripts/tests/checklist (23 files).
  - Staged footprint: `1562 insertions`, `49 deletions`.
  - No broad docs sweep included in staged commit.
- Focused commit message prepared:
  - **Title:** `feat(payor-geo): harden public geo/search contracts and add release readiness checks`
  - **Body:** `Add canonical geo normalization + diagnostics consistency across public routes, add release/readiness scripts, and introduce multi-state payor smoke coverage so deploys fail fast on route/schema drift.`
