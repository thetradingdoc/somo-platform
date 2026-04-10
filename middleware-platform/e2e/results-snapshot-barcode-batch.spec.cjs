/**
 * Batch: for ~50 distinct barcodes, verify GET results returns session_result_snapshot
 * after thread-event (barcode context) + landing analyze turn.
 *
 * Requires middleware on API_BASE_URL (default http://127.0.0.1:4000).
 * Barcodes are discovered from Open Beauty Facts search (needs network).
 *
 * Run: API_BASE_URL=http://localhost:4000 npx playwright test e2e/results-snapshot-barcode-batch.spec.cjs
 */

const { test, expect } = require('@playwright/test');
const { randomUUID } = require('crypto');

const API_BASE = (process.env.API_BASE_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
const TARGET_COUNT = Math.min(60, Math.max(1, Number(process.env.SNAPSHOT_BATCH_TARGET || 50)));
const OBF_SEARCH = [
  'moisturizer',
  'serum',
  'shampoo',
  'sunscreen',
  'cleanser',
  'lip balm',
  'body lotion',
  'face cream'
];

async function collectCodesFromObf(request, maxCodes = 200) {
  const seen = new Set();
  const out = [];
  for (const term of OBF_SEARCH) {
    if (out.length >= maxCodes) break;
    const url = `https://world.openbeautyfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(
      term
    )}&json=1&page_size=50&fields=code`;
    const resp = await request.get(url);
    if (!resp.ok()) continue;
    const data = await resp.json().catch(() => ({}));
    const products = Array.isArray(data.products) ? data.products : [];
    for (const p of products) {
      const raw = String(p?.code || '').replace(/\D/g, '');
      if (!/^\d{8,14}$/.test(raw) || seen.has(raw)) continue;
      seen.add(raw);
      out.push(raw);
      if (out.length >= maxCodes) break;
    }
  }
  return out;
}

async function filterLocalBeautyFacts(request, codes, need) {
  const ok = [];
  for (const code of codes) {
    if (ok.length >= need) break;
    const r = await request.get(`${API_BASE}/api/public/beautyfacts/${code}`);
    const j = await r.json().catch(() => ({}));
    if (r.ok() && j.success && j.product && j.product.found !== false) {
      ok.push({ code, product: j.product });
    }
  }
  return ok;
}

function buildThreadText(product, code) {
  const name = product.product_name || product.name || `product ${code}`;
  const img = String(product.image_url || product.image_front_url || '').trim();
  const ing = String(product.ingredients_text || '').slice(0, 600);
  return [
    `[Barcode Scan] ${name} (${code})`,
    img ? `Product image: ${img}` : '',
    ing ? `Ingredients: ${ing}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

async function assertSnapshotForProduct(request, { code, product }) {
  const sid = randomUUID();
  const text = buildThreadText(product, code);
  const te = await request.post(`${API_BASE}/api/public/landing-assistant/thread-event`, {
    data: { session_id: sid, type: 'barcode_product_context', text }
  });
  expect(te.ok(), `thread-event failed ${code}`).toBeTruthy();

  const turn = await request.post(`${API_BASE}/api/public/landing-assistant/turn`, {
    data: {
      session_id: sid,
      message:
        'Analyze the scanned product in my session for my skin: summarize fit and conflicts. Generate skincare report snapshot.'
    }
  });
  const turnJson = await turn.json().catch(() => ({}));
  expect(turn.ok(), `turn failed ${code}: ${JSON.stringify(turnJson).slice(0, 200)}`).toBeTruthy();

  const res = await request.get(`${API_BASE}/api/public/landing-assistant/results/${encodeURIComponent(sid)}`);
  const resJson = await res.json().catch(() => ({}));
  expect(res.ok(), `results GET failed ${code}`).toBeTruthy();
  expect(resJson.success, `results not success ${code}`).toBeTruthy();
  const snap = resJson.session_result_snapshot;
  expect(snap, `missing session_result_snapshot for ${code}`).toBeTruthy();
  expect(String(snap.schema_version || '').length, `schema_version ${code}`).toBeGreaterThan(0);
  expect(String(snap.primary_concern || '').length, `primary_concern ${code}`).toBeGreaterThan(0);
}

test.describe('results snapshot batch (barcodes)', () => {
  test.setTimeout(900000);

  test(`snapshot present for ${TARGET_COUNT} local BeautyFacts products`, async ({ request }) => {
    const obfCodes = await collectCodesFromObf(request, 220);
    expect(obfCodes.length, 'need codes from OBF search').toBeGreaterThan(10);

    const products = await filterLocalBeautyFacts(request, obfCodes, TARGET_COUNT);
    expect(
      products.length,
      `need at least ${TARGET_COUNT} products resolved by local /api/public/beautyfacts (got ${products.length}). Is middleware running on ${API_BASE}?`
    ).toBeGreaterThanOrEqual(TARGET_COUNT);

    const slice = products.slice(0, TARGET_COUNT);
    for (let i = 0; i < slice.length; i++) {
      const item = slice[i];
      await assertSnapshotForProduct(request, item);
    }
  });
});
