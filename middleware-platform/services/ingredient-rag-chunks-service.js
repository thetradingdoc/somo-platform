'use strict';

function getSqlite() {
  return require('../database').db;
}

function _conn(db) {
  return db && typeof db.prepare === 'function' ? db : getSqlite();
}

/**
 * Retrieve curated monograph chunks for resolved ingredient ids (cosing:...) and/or graph reason_codes.
 * @param {string[]} ingredientIds
 * @param {import('better-sqlite3').Database} [db] — optional (defaults to app database)
 */
function getChunksByIngredientIds(ingredientIds = [], db = null) {
  const ids = [...new Set((ingredientIds || []).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean))];
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  try {
    return _conn(db)
      .prepare(
        `
      SELECT id, ingredient_canonical_id, reason_code, title, body, source, evidence_level
      FROM ingredient_rag_chunks
      WHERE lower(ingredient_canonical_id) IN (${placeholders})
      ORDER BY title ASC
    `
      )
      .all(...ids);
  } catch (_) {
    return [];
  }
}

function getChunksByReasonCodes(reasonCodes = [], db = null) {
  const codes = [...new Set((reasonCodes || []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!codes.length) return [];
  const placeholders = codes.map(() => '?').join(',');
  try {
    return _conn(db)
      .prepare(
        `
      SELECT id, ingredient_canonical_id, reason_code, title, body, source, evidence_level
      FROM ingredient_rag_chunks
      WHERE reason_code IN (${placeholders})
      ORDER BY title ASC
    `
      )
      .all(...codes);
  } catch (_) {
    return [];
  }
}

/**
 * Merge chunks for a routine verdict (dedupe by id).
 * @param {import('better-sqlite3').Database} [db]
 */
function getChunksForRoutineVerdict(verdict, db = null) {
  if (!verdict || typeof verdict !== 'object') return [];
  const ids = new Set();
  const codes = new Set();
  for (const c of verdict.conflicts || []) {
    for (const rc of c.reason_codes || []) {
      codes.add(rc);
    }
    if (c.ingredient_a) ids.add(String(c.ingredient_a).toLowerCase());
    if (c.ingredient_b) ids.add(String(c.ingredient_b).toLowerCase());
  }
  const byId = getChunksByIngredientIds([...ids], db);
  const byRc = getChunksByReasonCodes([...codes], db);
  const seen = new Set();
  const out = [];
  for (const row of [...byId, ...byRc]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

/**
 * When unified retriever is unavailable, map legacy ingredient_rag rows to the same chunk shape
 * as createRetriever()._ragToChunk (text includes title when present).
 */
function unifiedChunksFromLegacyRagRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.map((r) => {
    const mono = r.ingredient_canonical_id || null;
    const codes = r.reason_code ? [r.reason_code] : [];
    const text = r.title ? `${r.title}: ${r.body || ''}` : r.body || '';
    return {
      id: r.id,
      ingredient_a: mono,
      ingredient_b: null,
      reason_codes: codes,
      text,
      source: r.source || 'ingredient_rag_chunks',
      evidence_level: r.evidence_level || 'probable',
      supports: mono ? [mono] : [],
      chunk_source_tier: 'rag',
      product_id: null,
      sku: null,
    };
  });
}

/** Map unified chunks to legacy `rag_rows` shape (opt-in via KELLY_ROUTINE_DUAL_RAG_SHAPES). */
function legacyRowsFromUnifiedChunks(chunks) {
  if (!Array.isArray(chunks) || !chunks.length) return [];
  return chunks.map((ch) => {
    const codes = Array.isArray(ch.reason_codes) ? ch.reason_codes : [];
    const firstCode = codes[0] || '';
    const monoId =
      ch.ingredient_a && !ch.ingredient_b
        ? ch.ingredient_a
        : Array.isArray(ch.supports) && ch.supports[0]
          ? ch.supports[0]
          : null;
    const titleFromText = String(ch.text || '').split(/[.:\n]/)[0].trim().slice(0, 120) || ch.id;
    return {
      id: ch.id,
      ingredient_canonical_id: monoId,
      reason_code: firstCode,
      title: titleFromText,
      body: ch.text || '',
      source: ch.source || 'unified_retriever',
      evidence_level: ch.evidence_level || 'probable',
    };
  });
}

module.exports = {
  getChunksByIngredientIds,
  getChunksByReasonCodes,
  getChunksForRoutineVerdict,
  legacyRowsFromUnifiedChunks,
  unifiedChunksFromLegacyRagRows,
};
