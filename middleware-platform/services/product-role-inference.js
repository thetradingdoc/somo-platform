'use strict';

/**
 * A2 — Infer skincare step role from merchant catalog (products.name/category/tags)
 * when session product.role is unknown. Does not persist; enriches read paths only.
 */

const VALID_INFERRED_ROLES = new Set([
  'unknown',
  'cleanser',
  'toner',
  'serum',
  'moisturizer',
  'sunscreen',
  'treatment',
  'mask',
  'oil',
  'other',
]);

function _norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function _haystack(name, category, tagsStr) {
  const tags = String(tagsStr || '')
    .split(/[,;|]/)
    .map((t) => _norm(t))
    .filter(Boolean);
  return [_norm(name), _norm(category), ...tags].join(' | ');
}

/**
 * @param {{ name?: string, category?: string, tags?: string }} row
 * @returns {string} VALID_PRODUCT_ROLES member
 */
function inferRoleFromCatalogRow(row) {
  const h = _haystack(row.name, row.category, row.tags);
  if (!h.trim()) return 'unknown';

  const rules = [
    { role: 'sunscreen', re: /\b(spf|sunscreen|sun\s*screen|uv\s*a?\s*b|broad[\s-]*spectrum)\b/i },
    { role: 'cleanser', re: /\b(cleanser|cleansing|face\s*wash|wash|foaming|gel\s*clean|micellar|shampoo)\b/i },
    { role: 'toner', re: /\b(toner|astringent|essence\s*mist)\b/i },
    { role: 'serum', re: /\b(serum|ampoule|concentrate|booster)\b/i },
    { role: 'moisturizer', re: /\b(moisturiz|hydrat|cream|lotion|balm|gel-cream|emulsion)\b/i },
    { role: 'oil', re: /\b(facial\s*oil|face\s*oil|oil\s*serum|oil\b)\b/i },
    { role: 'mask', re: /\b(mask|masque|peel\s*off|sheet\s*mask|clay)\b/i },
    { role: 'treatment', re: /\b(treatment|retin|tretin|adapalene|benzoyl|peel|exfoliat|acid\s*treatment)\b/i },
  ];

  for (const { role, re } of rules) {
    if (re.test(h)) return role;
  }

  const cat = _norm(row.category);
  if (cat.includes('sun')) return 'sunscreen';
  if (cat.includes('clean')) return 'cleanser';
  if (cat.includes('serum')) return 'serum';
  if (cat.includes('moist')) return 'moisturizer';
  if (cat.includes('toner')) return 'toner';
  if (cat.includes('mask')) return 'mask';
  if (cat.includes('treatment')) return 'treatment';

  return 'unknown';
}

function createCatalogRoleLookup(db) {
  if (!db) return () => 'unknown';
  let stmt = null;
  try {
    stmt = db.prepare(
      'SELECT name, category, tags FROM products WHERE id = ? LIMIT 1'
    );
  } catch (_) {
    stmt = null;
  }
  return function lookupProductRole(productId) {
    if (!stmt || productId == null || String(productId).trim() === '') return 'unknown';
    try {
      const row = stmt.get(String(productId));
      if (!row) return 'unknown';
      const role = inferRoleFromCatalogRow(row);
      return VALID_INFERRED_ROLES.has(role) ? role : 'unknown';
    } catch (_) {
      return 'unknown';
    }
  };
}

/**
 * Deep-enrich routine products with catalog role when role is missing or unknown.
 * @param {import('better-sqlite3').Database} db
 * @param {object[]} current_routine
 */
function enrichCurrentRoutineWithCatalogRoles(db, current_routine) {
  const lookup = createCatalogRoleLookup(db);
  if (!Array.isArray(current_routine)) return current_routine;
  return current_routine.map((slot) => ({
    ...slot,
    products: (slot.products || []).map((p) => {
      const cur = p.role != null ? String(p.role) : 'unknown';
      if (cur !== 'unknown') return { ...p, role: cur };
      const inferred = lookup(p.product_id);
      return { ...p, role: inferred !== 'unknown' ? inferred : 'unknown' };
    }),
  }));
}

module.exports = {
  inferRoleFromCatalogRow,
  createCatalogRoleLookup,
  enrichCurrentRoutineWithCatalogRoles,
  VALID_INFERRED_ROLES,
};
