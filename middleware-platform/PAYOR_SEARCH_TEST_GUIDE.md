# Payor search — pre-push test checklist

## Architecture note (normalization vs DB)

- **`services/geo-normalize.js`** — pure `normalizeZip` / `normalizeCountyName` (no `database.js`, no migrations). Unit tests and fixture blocks import this file only.
- **`services/geo-resolver-service.js`** — ZIP/county resolution against SQLite; imports normalizers from `geo-normalize.js` and re-exports them for backward compatibility.

## Data checks before prod / open enrollment

```bash
cd middleware-platform

# Row counts for zip_county_crosswalk (uses app DB from env / default dev DB)
npm run geo:check:crosswalk-count

# Stricter canonical/geo gates (tune GEO_GUARD_* env vars for partial datasets)
npm run geo:verify:release-readiness
```

On a remote host with only `sqlite3` and a DB path:

```bash
sqlite3 /path/to/payor.db "SELECT COUNT(*) AS c FROM zip_county_crosswalk;"
```

## PR / API contract note

- **`geo_version`** is included on **`400`** and **`422`** responses from `/api/public/plans/search` (and success payloads). Any client that assumed `400` bodies never include `geo_version` must be updated.

## One-shot local gate (repo root)

```bash
npm run verify:payor-navigator:local
```

Runs crosswalk count script, full **middleware-platform** Jest suite, then **littlelab-landing** production build.

---

## Quick reference

```bash
cd middleware-platform

# Unit tests only (no server — runs in CI)
npx jest __tests__/geo-resolver-county-normalization.test.js --runInBand

# Full smoke suite (requires running middleware on port 4000)
RUN_PAYOR_HTTP_SMOKE=1 npx jest __tests__/payor-location-smoke.test.js --runInBand

# Both at once
RUN_PAYOR_HTTP_SMOKE=1 npx jest \
  __tests__/geo-resolver-county-normalization.test.js \
  __tests__/payor-location-smoke.test.js \
  --runInBand --verbose

# Against a non-local server
PAYOR_TEST_API_BASE=http://payor-pipeline-runner:4000 \
RUN_PAYOR_HTTP_SMOKE=1 npx jest __tests__/payor-location-smoke.test.js --runInBand
```

---

## What each test file covers

### `geo-resolver-county-normalization.test.js`

Unit tests — no server, no live HTTP, suitable for CI.

| Area | What it tests |
|------|----------------|
| `normalizeZip` | 5-digit, ZIP+4, whitespace, non-digit stripping, truncation, null/empty (via **`geo-normalize.js`**) |
| `normalizeCountyName` | County suffix strip, St./Saint, hyphens (e.g. Miami-Dade), CMS samples (via **`geo-normalize.js`**) |

### `payor-location-smoke.test.js`

HTTP integration tests — **skipped** unless `RUN_PAYOR_HTTP_SMOKE=1` and the server responds.

| Area | What it tests |
|------|----------------|
| Error paths | Missing ZIP, missing needs → **400** + `geo_version`; unknown ZIP → not 500 + `geo_version` |
| Meta | `/api/public/plans/meta` returns numeric counts |
| Matrix | `SEARCH_CASES` in the file — multi-state ZIP / county / sort / multi-ZIP leakage |
| Leakage | When `noLeakage` and **200 with plans**, every plan must have **`state_abbr`** matching the expected state (API must expose `state_abbr` per plan) |
| Fixtures | Offline shape checks + `normalizeZip` / `normalizeCountyName` round-trips |

---

## Geographic coverage matrix

See `SEARCH_CASES` in `__tests__/payor-location-smoke.test.js` for the authoritative list (labels include state, county/ZIP, and needs).

High-risk cases for **out-of-state leakage** on multi-county ZIPs: `07001` (NJ), `11001` (NY), `22003` (VA), and `33101` (FL).

---

## What "passing" means for prod readiness

### Hard gates (must be green before push)

- [ ] All unit tests pass (`geo-resolver-county-normalization.test.js`)
- [ ] With smoke enabled: no **500** on matrix cases
- [ ] **`geo_version`** present on **400**, **422**, and **200** search/meta responses used in tests
- [ ] **200** responses: `success: true`, `Array.isArray(plans)`
- [ ] **Multi-county / FL rows**: when plans are returned, **no out-of-state** plans (`state_abbr` on each plan)
- [ ] Sort checks where applicable (stars desc, MOOP asc)
- [ ] Plan cards: `payer_name`, `contract_id`, numeric `monthly_premium >= 0`, `coverage_detail` object

### Soft gates (acceptable if explained)

- [ ] **0 plans** on **200** — can mean no MA rows for that service area in the loaded DB
- [ ] **`input` echo** on county scope responses

---

## Understanding 422 vs 0-plan 200

| Response | Meaning | Action |
|----------|---------|--------|
| **422** `zip_unmapped` | ZIP not in crosswalk / resolver cannot map | User picks state/county; `geo_version` must be present |
| **422** `location_scope_unavailable` | Missing service-area tables, etc. | Ops / deploy fix |
| **200**, `plans: []` | Location resolved (or broad scope) but no matching plans in DB | Often expected for sparse areas |
| **200**, `plans: [...]` | Success | Validate shape + leakage |
| **500** | Bug | Never acceptable for these routes |

**Note:** There is no separate HTTP code **`ambiguous_zip`** today. Ambiguous multi-county ZIP behavior is reflected by **`zip_unmapped`** (until disambiguation is implemented) or by **200** results that must still pass **state** checks when plans exist.

---

## Bridge vs search (do not conflate)

MA bridge / entity-resolution stats are a **different track** from public plan search.

`/api/public/plans/search` uses (among others):

- `payor_plan_premiums`
- `payor_plan_benefits`
- `payor_plan_service_areas`
- `zip_county_crosswalk` (and canonical geo tables when built)

Bridge linkage counts **do not** prove ZIP search correctness. Use the tests above.

### Run smoke against a GCP VM (example)

```bash
PAYOR_TEST_API_BASE=http://$(gcloud compute instances describe payor-pipeline-runner \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'):4000 \
RUN_PAYOR_HTTP_SMOKE=1 \
npx jest __tests__/payor-location-smoke.test.js --runInBand --verbose
```
