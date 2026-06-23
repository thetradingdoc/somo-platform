'use strict';

const crypto = require('crypto');
const dbModule = require('../../database');
const { resolveProductGrade } = require('./product-grade-resolver');
const { enrichProductRegulatorySignals } = require('./product-taxonomy-enricher');
const { normalizeInciToken } = require('./ingredient-normalization-resolver');

const db = dbModule.db;

function productIngredientsHasExtendedColumns() {
  try {
    const cols = db.prepare('PRAGMA table_info(product_ingredients)').all().map((c) => c.name);
    return cols.includes('normalized_inci');
  } catch (_) {
    return false;
  }
}

function slug(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function upsertFromBeautyFacts(normalized, mergedGrade) {
  const productName = String(normalized?.product_name || '').trim();
  if (!productName) return { ok: false, reason: 'missing_product_name' };
  const barcode = String(normalized?.barcode || '').trim();
  const brand = String((normalized?.brands || [])[0] || '').trim() || null;
  const productId = `obf:${barcode || slug(productName)}`;
  const normalizedName = slug(`${brand || ''} ${productName}`);
  const obfOnly = resolveProductGrade({
    productName,
    labels: normalized?.labels || [],
    categories: normalized?.categories || [],
    categories_tags: normalized?.categories_tags || [],
    ingredients_analysis_tags: normalized?.ingredients_analysis_tags || [],
    states_tags: normalized?.states_tags || [],
    ingredients: normalized?.ingredients || []
  });
  const grade = mergedGrade || {
    grade_class: obfOnly.grade_class,
    confidence: obfOnly.confidence,
    source_priority: 'open_beauty_facts',
    regulatory_basis_json: { rationale: obfOnly.rationale, source: 'resolver_v1' },
    drug_facts_present: obfOnly.grade_class === 'OTC_DRUG' ? 1 : 0,
    distribution_channel: obfOnly.grade_class === 'PROFESSIONAL' ? 'clinic' : 'retail'
  };

  db.prepare(`
    INSERT INTO products_catalog (
      id, source, source_product_id, brand, product_name, normalized_name, inci_text, metadata_json, updated_at
    ) VALUES (?, 'open_beauty_facts', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      brand=excluded.brand,
      product_name=excluded.product_name,
      normalized_name=excluded.normalized_name,
      inci_text=excluded.inci_text,
      metadata_json=excluded.metadata_json,
      updated_at=CURRENT_TIMESTAMP
  `).run(
    productId,
    barcode || null,
    brand,
    productName,
    normalizedName,
    normalized?.ingredients_text || null,
    JSON.stringify({
      labels: normalized?.labels || [],
      categories: normalized?.categories || [],
      image_url: normalized?.image_url || null,
      product_url: normalized?.product_url || null
    })
  );

  db.prepare(`
    INSERT INTO product_regulatory_profiles (
      product_id, grade_class, grade_confidence, regulatory_basis_json, drug_facts_present, distribution_channel, source_priority, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(product_id) DO UPDATE SET
      grade_class=excluded.grade_class,
      grade_confidence=excluded.grade_confidence,
      regulatory_basis_json=excluded.regulatory_basis_json,
      drug_facts_present=excluded.drug_facts_present,
      distribution_channel=excluded.distribution_channel,
      source_priority=excluded.source_priority,
      updated_at=CURRENT_TIMESTAMP
  `).run(
    productId,
    grade.grade_class,
    grade.confidence,
    JSON.stringify(grade.regulatory_basis_json || {}),
    grade.drug_facts_present != null ? grade.drug_facts_present : grade.grade_class === 'OTC_DRUG' ? 1 : 0,
    grade.distribution_channel || (grade.grade_class === 'PROFESSIONAL' ? 'clinic' : 'retail'),
    grade.source_priority || 'merged'
  );

  const ingredients = Array.isArray(normalized?.ingredients) ? normalized.ingredients : [];
  const extended = productIngredientsHasExtendedColumns();
  for (let i = 0; i < ingredients.length; i++) {
    const row = ingredients[i];
    const raw =
      row && typeof row === 'object'
        ? String(row.text || row.id || '').trim()
        : String(row || '').trim();
    if (!raw) continue;
    const inci = raw.toLowerCase();
    const norm = normalizeInciToken(raw);
    const iid = crypto.createHash('sha1').update(`${productId}|${inci}|${i}`).digest('hex').slice(0, 24);
    if (extended) {
      try {
        db.prepare(`
          INSERT OR IGNORE INTO product_ingredients (id, product_id, inci_name, ingredient_order, raw_ingredient, normalized_inci, ingredient_role, confidence)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(iid, productId, inci, i + 1, raw, norm, 'unknown', 'medium');
      } catch (_) {
        db.prepare(`
          INSERT OR IGNORE INTO product_ingredients (id, product_id, inci_name, ingredient_order, raw_ingredient)
          VALUES (?, ?, ?, ?, ?)
        `).run(iid, productId, inci, i + 1, raw);
      }
    } else {
      db.prepare(`
        INSERT OR IGNORE INTO product_ingredients (id, product_id, inci_name, ingredient_order, raw_ingredient)
        VALUES (?, ?, ?, ?, ?)
      `).run(iid, productId, inci, i + 1, raw);
    }
  }

  return {
    ok: true,
    product_id: productId,
    grade: { grade_class: grade.grade_class, confidence: grade.confidence, source_priority: grade.source_priority }
  };
}

async function upsertProductTaxonomyFullPipeline(normalized) {
  const enriched = await enrichProductRegulatorySignals(normalized);
  const saved = upsertFromBeautyFacts(normalized, enriched.merged);
  return { ...saved, enrichment: enriched };
}

function logBarcodeLookup({ barcode, source, hit, productId, gradeClass, confidence, details }) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO barcode_lookup_events (id, barcode, source, hit, product_id, grade_class, confidence, details_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, barcode, source, hit ? 1 : 0, productId || null, gradeClass || null, confidence || null, JSON.stringify(details || {}));
}

module.exports = { upsertFromBeautyFacts, upsertProductTaxonomyFullPipeline, logBarcodeLookup };
