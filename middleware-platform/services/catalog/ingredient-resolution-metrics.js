'use strict';

function getSqlite() {
  return require('../../database').db;
}

/**
 * Aggregate resolution quality across product_ingredients (after migration 024/027).
 */
function getIngredientResolutionMetrics() {
  try {
    const db = getSqlite();
    const total = db.prepare(`SELECT COUNT(*) AS n FROM product_ingredients`).get();
    const byMethod = db
      .prepare(
        `
      SELECT match_method, COUNT(*) AS n
      FROM product_ingredients
      GROUP BY match_method
      ORDER BY n DESC
    `
      )
      .all();
    const resolved = db
      .prepare(
        `
      SELECT COUNT(*) AS n FROM product_ingredients
      WHERE match_method IN ('exact','alias','fuzzy')
    `
      )
      .get();
    const unresolved = db
      .prepare(
        `
      SELECT COUNT(*) AS n FROM product_ingredients
      WHERE match_method = 'unresolved' OR match_method IS NULL OR ingredient_canonical_id IS NULL
    `
      )
      .get();
    const nTot = Number(total?.n || 0);
    const nRes = Number(resolved?.n || 0);
    const pct = nTot ? Math.round((nRes / nTot) * 10000) / 100 : 0;
    return {
      total_rows: nTot,
      resolved_exact_or_alias_count: nRes,
      pct_resolved_exact_or_alias: pct,
      unresolved_or_no_canonical_count: Number(unresolved?.n || 0),
      by_match_method: byMethod.map((r) => ({ match_method: r.match_method, count: r.n }))
    };
  } catch (e) {
    return { error: e.message, total_rows: 0, by_match_method: [] };
  }
}

/**
 * Top INCI tokens still unresolved (by frequency).
 */
function getTopUnresolvedInciTokens(limit = 25) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 25));
  try {
    return getSqlite()
      .prepare(
        `
      SELECT inci_name, COUNT(*) AS n
      FROM product_ingredients
      WHERE match_method = 'unresolved' OR (ingredient_canonical_id IS NULL AND match_method IS NOT 'noise')
      GROUP BY lower(inci_name)
      ORDER BY n DESC
      LIMIT ?
    `
      )
      .all(lim);
  } catch (_) {
    return [];
  }
}

module.exports = {
  getIngredientResolutionMetrics,
  getTopUnresolvedInciTokens
};
