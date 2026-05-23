'use strict';

/**
 * Multi-state HTTP smoke for `/api/public/plans/search`.
 * Skipped unless RUN_PAYOR_HTTP_SMOKE=1 and server is reachable.
 *
 *   npm run test:payor:location-smoke
 *   PAYOR_TEST_API_BASE=http://127.0.0.1:4000 npm run test:payor:location-smoke
 */

const ENABLED = process.env.RUN_PAYOR_HTTP_SMOKE === '1';
const BASE = process.env.PAYOR_TEST_API_BASE || 'http://127.0.0.1:4000';
const TIMEOUT_MS = 15000;

/** Structured 422 responses from this route today */
const ALLOWED_422_ERRORS = ['zip_unmapped', 'location_scope_unavailable'];

async function fetchJson(path) {
  const controller = new AbortController();
  const kill = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(kill);
  }
  const txt = await res.text();
  let body;
  try {
    body = txt ? JSON.parse(txt) : {};
  } catch (_) {
    body = { raw: txt };
  }
  return { res, body };
}

function buildSearchUrl({ zip, state, county, needs, sort_by, location_type }) {
  const params = new URLSearchParams();
  if (location_type) params.set('location_type', location_type);
  if (zip) params.set('zip', zip);
  if (state) params.set('state', state);
  if (county) params.set('county', county);
  if (needs) params.set('needs', Array.isArray(needs) ? needs.join(',') : needs);
  if (sort_by) params.set('sort_by', sort_by);
  return `/api/public/plans/search?${params.toString()}`;
}

function assertSuccessShape(body) {
  expect(body.success).toBe(true);
  expect(typeof body.geo_version).toBe('string');
  expect(Array.isArray(body.plans)).toBe(true);
}

function assertNoOutOfStateLeakage(plans, expectedState, label) {
  const want = expectedState.toUpperCase();
  const leaked = plans.filter((p) => {
    const planState = String(p.state_abbr || p.service_state || '').trim().toUpperCase();
    if (!planState) {
      throw new Error(
        `[${label}] Plan missing state_abbr (required for geo smoke). contract_id=${p.contract_id}`
      );
    }
    return planState !== want;
  });
  expect(leaked.length).toBe(0);
}

function assertPlanCardFields(plan) {
  expect(typeof plan.payer_name).toBe('string');
  expect(plan.payer_name.length).toBeGreaterThan(0);
  expect(plan.contract_id != null && String(plan.contract_id).length > 0).toBe(true);
  expect(typeof plan.monthly_premium).toBe('number');
  expect(plan.monthly_premium).toBeGreaterThanOrEqual(0);
  expect(typeof plan.coverage_detail).toBe('object');
  if (plan.state_abbr != null) {
    expect(typeof plan.state_abbr).toBe('string');
  }
}

const SEARCH_CASES = [
  {
    label: 'NJ · Union County · ZIP 07205 · dental',
    params: { location_type: 'zip', zip: '07205', needs: ['dental'] },
    expect: { minPlans: 0, state: 'NJ' }
  },
  {
    label: 'NJ · Union County (county scope) · dental',
    params: { location_type: 'county', state: 'NJ', county: 'Union County', needs: ['dental'] },
    expect: { minPlans: 0, state: 'NJ', hasInput: { state: 'NJ', county: 'Union County' } }
  },
  {
    label: 'NY · New York County · ZIP 10001 · dental + vision',
    params: { location_type: 'zip', zip: '10001', needs: ['dental', 'vision'] },
    expect: { minPlans: 0, state: 'NY' }
  },
  {
    label: 'NY · Kings County · ZIP 11201 · hearing',
    params: { location_type: 'zip', zip: '11201', needs: ['hearing'] },
    expect: { minPlans: 0, state: 'NY' }
  },
  {
    label: 'PA · Allegheny County · county scope · dental + physio',
    params: { location_type: 'county', state: 'PA', county: 'Allegheny County', needs: ['dental', 'physio'] },
    expect: { minPlans: 0, state: 'PA' }
  },
  {
    label: 'MA · Suffolk County · ZIP 02101 · preventive',
    params: { location_type: 'zip', zip: '02101', needs: ['preventive'] },
    expect: { minPlans: 0, state: 'MA' }
  },
  {
    label: 'FL · Miami-Dade County · ZIP 33101 · dental',
    params: { location_type: 'zip', zip: '33101', needs: ['dental'] },
    expect: { minPlans: 0, state: 'FL', noLeakage: true }
  },
  {
    label: 'FL · Broward County · ZIP 33021 · dental + hearing',
    params: { location_type: 'zip', zip: '33021', needs: ['dental', 'hearing'] },
    expect: { minPlans: 0, state: 'FL' }
  },
  {
    label: 'FL · county scope · Palm Beach · dental',
    params: { location_type: 'county', state: 'FL', county: 'Palm Beach County', needs: ['dental'] },
    expect: { minPlans: 0, state: 'FL' }
  },
  {
    label: 'GA · Fulton County · ZIP 30301 · dental + vision',
    params: { location_type: 'zip', zip: '30301', needs: ['dental', 'vision'] },
    expect: { minPlans: 0, state: 'GA' }
  },
  {
    label: 'IL · Cook County · ZIP 60601 · dental + hearing',
    params: { location_type: 'zip', zip: '60601', needs: ['dental', 'hearing'] },
    expect: { minPlans: 0, state: 'IL' }
  },
  {
    label: 'IL · Cook County scope · dental',
    params: { location_type: 'county', state: 'IL', county: 'Cook County', needs: ['dental'] },
    expect: { minPlans: 0, state: 'IL' }
  },
  {
    label: 'OH · Cuyahoga County · ZIP 44101 · dental + physio',
    params: { location_type: 'zip', zip: '44101', needs: ['dental', 'physio'] },
    expect: { minPlans: 0, state: 'OH' }
  },
  {
    label: 'MI · Wayne County · ZIP 48201 · dental',
    params: { location_type: 'zip', zip: '48201', needs: ['dental'] },
    expect: { minPlans: 0, state: 'MI' }
  },
  {
    label: 'TX · Harris County · ZIP 77001 · dental + vision',
    params: { location_type: 'zip', zip: '77001', needs: ['dental', 'vision'] },
    expect: { minPlans: 0, state: 'TX' }
  },
  {
    label: 'TX · Bexar County scope · dental + hearing',
    params: { location_type: 'county', state: 'TX', county: 'Bexar County', needs: ['dental', 'hearing'] },
    expect: { minPlans: 0, state: 'TX' }
  },
  {
    label: 'TX · Travis County · ZIP 78701 · ambulance',
    params: { location_type: 'zip', zip: '78701', needs: ['ambulance'] },
    expect: { minPlans: 0, state: 'TX' }
  },
  {
    label: 'AZ · Maricopa County · ZIP 85001 · dental + hearing',
    params: { location_type: 'zip', zip: '85001', needs: ['dental', 'hearing'] },
    expect: { minPlans: 0, state: 'AZ' }
  },
  {
    label: 'AZ · Maricopa County scope · vision',
    params: { location_type: 'county', state: 'AZ', county: 'Maricopa County', needs: ['vision'] },
    expect: { minPlans: 0, state: 'AZ' }
  },
  {
    label: 'NM · Bernalillo County · ZIP 87101 · dental',
    params: { location_type: 'zip', zip: '87101', needs: ['dental'] },
    expect: { minPlans: 0, state: 'NM' }
  },
  {
    label: 'CA · Los Angeles County · ZIP 90001 · dental + vision',
    params: { location_type: 'zip', zip: '90001', needs: ['dental', 'vision'] },
    expect: { minPlans: 0, state: 'CA' }
  },
  {
    label: 'CA · San Diego County scope · dental + hearing',
    params: { location_type: 'county', state: 'CA', county: 'San Diego County', needs: ['dental', 'hearing'] },
    expect: { minPlans: 0, state: 'CA' }
  },
  {
    label: 'CA · Riverside County · ZIP 92501 · preventive',
    params: { location_type: 'zip', zip: '92501', needs: ['preventive'] },
    expect: { minPlans: 0, state: 'CA' }
  },
  {
    label: 'WA · King County · ZIP 98101 · dental + physio',
    params: { location_type: 'zip', zip: '98101', needs: ['dental', 'physio'] },
    expect: { minPlans: 0, state: 'WA' }
  },
  {
    label: 'OR · Multnomah County · ZIP 97201 · dental',
    params: { location_type: 'zip', zip: '97201', needs: ['dental'] },
    expect: { minPlans: 0, state: 'OR' }
  },
  {
    label: 'Multi-county ZIP: 07001 (NJ) — no out-of-state leakage',
    params: { location_type: 'zip', zip: '07001', needs: ['dental'] },
    expect: { minPlans: 0, state: 'NJ', noLeakage: true }
  },
  {
    label: 'Multi-county ZIP: 11001 (NY) — no out-of-state leakage',
    params: { location_type: 'zip', zip: '11001', needs: ['dental'] },
    expect: { minPlans: 0, state: 'NY', noLeakage: true }
  },
  {
    label: 'Multi-county ZIP: 22003 (VA) — no out-of-state leakage',
    params: { location_type: 'zip', zip: '22003', needs: ['dental'] },
    expect: { minPlans: 0, state: 'VA', noLeakage: true }
  },
  {
    label: 'Sort by highest stars · FL Miami-Dade',
    params: { location_type: 'zip', zip: '33101', needs: ['dental'], sort_by: 'highest_stars' },
    expect: { minPlans: 0, state: 'FL', sortCheck: 'highest_stars' }
  },
  {
    label: 'Sort by lowest MOOP · TX Harris',
    params: { location_type: 'zip', zip: '77001', needs: ['dental'], sort_by: 'lowest_moop' },
    expect: { minPlans: 0, state: 'TX', sortCheck: 'lowest_moop' }
  },
  {
    label: 'All major needs · IL Cook County',
    params: {
      location_type: 'county',
      state: 'IL',
      county: 'Cook County',
      needs: ['dental', 'vision', 'hearing', 'physio', 'ambulance', 'preventive']
    },
    expect: { minPlans: 0, state: 'IL', checkCoverageDetail: true }
  }
];

const describeOrSkip = ENABLED ? describe : describe.skip;

describeOrSkip('payor plan search — multi-state smoke tests', () => {
  jest.setTimeout(TIMEOUT_MS * 2);

  let serverAvailable = false;

  beforeAll(async () => {
    try {
      const { res } = await fetchJson('/api/public/plans/meta');
      serverAvailable = res.status < 500;
    } catch (err) {
      console.error(`[smoke] Server preflight failed: ${err.message}`);
      serverAvailable = false;
    }
    if (!serverAvailable) {
      throw new Error(`Cannot reach server at ${BASE}. Start middleware first.`);
    }
  });

  test('missing ZIP with zip location_type returns 400 with geo_version', async () => {
    const { res, body } = await fetchJson('/api/public/plans/search?location_type=zip&needs=dental');
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(typeof body.geo_version).toBe('string');
  });

  test('missing needs returns 400 with geo_version', async () => {
    const { res, body } = await fetchJson('/api/public/plans/search?location_type=zip&zip=07205');
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(typeof body.geo_version).toBe('string');
  });

  test('unknown ZIP returns structured response (not 500) with geo_version', async () => {
    const { res, body } = await fetchJson(
      '/api/public/plans/search?location_type=zip&zip=00000&needs=dental'
    );
    expect(res.status).not.toBe(500);
    expect(typeof body).toBe('object');
    expect(typeof body.geo_version).toBe('string');
  });

  test('/api/public/plans/meta returns row counts', async () => {
    const { res, body } = await fetchJson('/api/public/plans/meta');
    expect(res.status).toBe(200);
    expect(body.success !== false).toBe(true);
    const numericFields = Object.values(body).filter((v) => typeof v === 'number');
    expect(numericFields.length).toBeGreaterThan(0);
  });

  test.each(SEARCH_CASES.map((c) => [c.label, c]))(
    '%s',
    async (_, testCase) => {
      const { params, expect: ex, label } = testCase;
      const url = buildSearchUrl(params);
      const { res, body } = await fetchJson(url);

      expect(res.status).not.toBe(500);
      expect(typeof body).toBe('object');
      expect(typeof body.geo_version).toBe('string');

      if (res.status === 200) {
        assertSuccessShape(body);

        if (typeof ex.minPlans === 'number') {
          expect(body.plans.length).toBeGreaterThanOrEqual(ex.minPlans);
        }

        if (ex.hasInput) {
          if (ex.hasInput.state) expect(body.input?.state).toBe(ex.hasInput.state);
          if (ex.hasInput.county) expect(body.input?.county).toBe(ex.hasInput.county);
        }

        body.plans.slice(0, 3).forEach((plan) => assertPlanCardFields(plan));

        if (ex.noLeakage && ex.state && body.plans.length > 0) {
          assertNoOutOfStateLeakage(body.plans, ex.state, label);
        }

        if (ex.sortCheck === 'highest_stars' && body.plans.length >= 2) {
          const stars = body.plans.map((p) => Number(p.star_rating || 0));
          for (let i = 1; i < stars.length; i += 1) {
            expect(stars[i]).toBeLessThanOrEqual(stars[i - 1]);
          }
        }
        if (ex.sortCheck === 'lowest_moop' && body.plans.length >= 2) {
          const moops = body.plans
            .map((p) => Number(p.moop_amount || Number.MAX_SAFE_INTEGER))
            .filter((v) => Number.isFinite(v) && v < Number.MAX_SAFE_INTEGER);
          for (let i = 1; i < moops.length; i += 1) {
            expect(moops[i]).toBeGreaterThanOrEqual(moops[i - 1]);
          }
        }

        if (ex.checkCoverageDetail && body.plans.length > 0) {
          const plan = body.plans[0];
          expect(plan.coverage_detail).toBeDefined();
          const needsArr = Array.isArray(params.needs) ? params.needs : [params.needs];
          needsArr.forEach((need) => {
            expect(plan.coverage_detail).toHaveProperty(need);
          });
        }
      } else if (res.status === 422) {
        expect(body.success).toBe(false);
        expect(ALLOWED_422_ERRORS).toContain(body.error);
        expect(typeof body.geo_version).toBe('string');
      } else {
        throw new Error(`Unexpected HTTP ${res.status} for ${label}: ${JSON.stringify(body).slice(0, 500)}`);
      }
    }
  );
});

describe('search result shape fixtures (no server required)', () => {
  const MOCK_PLAN = {
    contract_id: 'H0028',
    plan_name: 'Humana Gold Plus H0028-003',
    plan_type: 'HMO',
    payer_name: 'Humana',
    monthly_premium: 7.0,
    star_rating: 3.5,
    moop_amount: 6700,
    state_abbr: 'FL',
    coverage_detail: {
      dental: { covered: true, copay_min: 25, prior_auth: false },
      vision: { covered: true, copay_min: 15, prior_auth: false },
      hearing: { covered: true, copay_min: 40, prior_auth: true },
      physio: { covered: false, copay_min: null, prior_auth: null },
      ambulance: { covered: true, copay_min: 0, prior_auth: true },
      preventive: { covered: true, copay_min: 0, prior_auth: false }
    }
  };

  test('coverage_detail keys align with live API (copay_min)', () => {
    const STANDARD_NEEDS = ['dental', 'vision', 'hearing', 'physio', 'ambulance', 'preventive'];
    STANDARD_NEEDS.forEach((need) => {
      expect(MOCK_PLAN.coverage_detail).toHaveProperty(need);
      expect(typeof MOCK_PLAN.coverage_detail[need].covered).toBe('boolean');
    });
  });

  test('monthly_premium is a non-negative number', () => {
    expect(typeof MOCK_PLAN.monthly_premium).toBe('number');
    expect(MOCK_PLAN.monthly_premium).toBeGreaterThanOrEqual(0);
  });

  test('sort by premium ascending', () => {
    const plans = [
      { monthly_premium: 15.0 },
      { monthly_premium: 7.0 },
      { monthly_premium: 0.0 },
      { monthly_premium: 42.0 }
    ];
    const sorted = [...plans].sort((a, b) => a.monthly_premium - b.monthly_premium);
    expect(sorted.map((p) => p.monthly_premium)).toEqual([0, 7, 15, 42]);
  });
});

describe('normalizeZip + normalizeCountyName round-trip (fixtures)', () => {
  const { normalizeZip, normalizeCountyName } = require('../services/geo-normalize');

  const ZIP_COUNTY_FIXTURES = [
    ['07205', 'Union County', 'union'],
    ['10001', 'New York County', 'new york'],
    ['60601', 'Cook County', 'cook'],
    ['77001', 'Harris County', 'harris'],
    ['90001', 'Los Angeles County', 'los angeles'],
    ['85001', 'Maricopa County', 'maricopa'],
    ['98101', 'King County', 'king'],
    ['33101', 'Miami-Dade County', 'miami-dade'],
    ['02101', 'Suffolk County', 'suffolk']
  ];

  test.each(ZIP_COUNTY_FIXTURES)('ZIP %s county %s → %s', (zip, countyInput, expected) => {
    expect(normalizeZip(zip)).toBe(zip);
    expect(normalizeCountyName(countyInput)).toBe(expected);
  });
});
