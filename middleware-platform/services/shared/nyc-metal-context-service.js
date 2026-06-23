'use strict';

const dbModule = require('../../database');

const DATASET_LABEL =
  'NYC Health Department historical lab tests on consumer products (reference only; not your batch or barcode).';

const PRIORITY_METALS = new Set(['Lead', 'Cadmium', 'Mercury', 'Arsenic', 'Chromium']);

function _enabled() {
  return String(process.env.NYC_METAL_CONTEXT_ENABLED || '1').trim() !== '0';
}

function normalizeProductName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantTokens(name) {
  const stop = new Set(['the', 'and', 'with', 'for', 'from', 'free', 'natural', 'product', 'unknown', 'not', 'stated']);
  const parts = normalizeProductName(name)
    .split(' ')
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && !stop.has(w));
  const uniq = [...new Set(parts)];
  uniq.sort((a, b) => b.length - a.length);
  return uniq.slice(0, 4);
}

function parseConcentration(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s === '-1') return { ppm: null, isNotDetected: true };
  const n = Number(String(s).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return { ppm: null, isNotDetected: true };
  return { ppm: n, isNotDetected: false };
}

/**
 * Build honest NYC reference context from a catalog product (OFF/OBF), not from INCI chemistry.
 * @param {{ productName?: string|null, categoriesTags?: string[], ingredientsText?: string|null, factsSource?: string|null }} input
 * @returns {object|null}
 */
function buildNycMetalContext(input = {}) {
  if (!_enabled()) return null;

  const db = dbModule.db;
  if (!db) return null;

  let hasTable = false;
  try {
    hasTable =
      !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='nyc_consumer_metal_tests'`).get();
  } catch (_) {
    return null;
  }
  if (!hasTable) return null;

  const productName = String(input.productName || '').trim();
  if (!productName) return null;

  const normScan = normalizeProductName(productName);
  let tokens = significantTokens(productName);
  if (!tokens.length) {
    const longest = normScan
      .split(' ')
      .filter((w) => w.length >= 6)
      .sort((a, b) => b.length - a.length)[0];
    if (longest) tokens = [longest];
  }
  if (!tokens.length) return null;

  const collected = new Map();
  const stmt = db.prepare(`
    SELECT id, product_type, product_name, product_name_normalized, metal, concentration_ppm, is_not_detected, collection_date, investigation_type
    FROM nyc_consumer_metal_tests
    WHERE metal != 'Total Solids'
      AND product_name_normalized LIKE ?
    LIMIT 60
  `);

  for (const tok of tokens) {
    const pat = `%${tok}%`;
    const rows = stmt.all(pat) || [];
    for (const r of rows) {
      if (!collected.has(r.id)) collected.set(r.id, r);
    }
  }

  const rows = [...collected.values()];
  if (!rows.length) {
    return {
      source: 'nyc_health_dept_consumer_metal_tests',
      dataset_version: String(process.env.NYC_METAL_DATASET_VERSION || 'imported').trim(),
      match_tier: 'none',
      disclaimer: DATASET_LABEL,
      summary:
        'No close matches in the loaded NYC reference dataset for this product name. That does not mean metals were tested on your item.',
      metals: [],
      sample_rows: []
    };
  }

  /** Score: prefer rows whose normalized name contains the full normalized scan or longer token overlap. */
  function scoreRow(r) {
    const pn = String(r.product_name_normalized || '');
    let s = 0;
    if (pn.includes(normScan) && normScan.length >= 8) s += 50;
    for (const t of tokens) {
      if (pn.includes(t)) s += t.length;
    }
    return s;
  }

  rows.sort((a, b) => scoreRow(b) - scoreRow(a));
  const topScore = rows.length ? scoreRow(rows[0]) : 0;
  let matchTier = 'weak';
  if (topScore >= 50) matchTier = 'moderate';
  if (topScore >= 80) matchTier = 'strong';

  const byMetal = new Map();
  for (const r of rows) {
    const m = String(r.metal || '').trim();
    if (!PRIORITY_METALS.has(m)) continue;
    if (!byMetal.has(m)) {
      byMetal.set(m, { metal: m, n_rows: 0, n_not_detected: 0, n_reported: 0, max_ppm: null });
    }
    const agg = byMetal.get(m);
    agg.n_rows += 1;
    if (r.is_not_detected) agg.n_not_detected += 1;
    else if (r.concentration_ppm != null && Number.isFinite(r.concentration_ppm)) {
      agg.n_reported += 1;
      agg.max_ppm = agg.max_ppm == null ? r.concentration_ppm : Math.max(agg.max_ppm, r.concentration_ppm);
    }
  }

  const metals = [...byMetal.values()].filter((x) => x.n_rows > 0);
  const sample_rows = rows.slice(0, 10).map((r) => ({
    product_name: String(r.product_name || '').slice(0, 120),
    product_type: String(r.product_type || '').slice(0, 80),
    metal: String(r.metal || ''),
    ppm: r.is_not_detected ? null : r.concentration_ppm,
    not_detected: !!r.is_not_detected,
    collection_date: r.collection_date != null ? String(r.collection_date).slice(0, 32) : null
  }));

  const ing = String(input.ingredientsText || '').toLowerCase();
  const formulation_note =
    ing.length > 12
      ? 'Your scan shows an ingredient list from the product database; it is not a heavy-metal lab report for this barcode.'
      : 'Ingredient disclosure from the database does not replace metals testing for this specific item.';

  return {
    source: 'nyc_health_dept_consumer_metal_tests',
    dataset_version: String(process.env.NYC_METAL_DATASET_VERSION || 'imported').trim(),
    match_tier: matchTier,
    disclaimer: DATASET_LABEL,
    summary: `Matched ${rows.length} NYC reference row(s) by product-name similarity (not ingredient tokens). ${formulation_note}`,
    scan_anchor: {
      product_name: productName.slice(0, 200),
      facts_source: input.factsSource != null ? String(input.factsSource) : null
    },
    metals,
    sample_rows
  };
}

module.exports = {
  buildNycMetalContext,
  normalizeProductName,
  significantTokens,
  parseConcentration,
  PRIORITY_METALS,
  DATASET_LABEL
};
