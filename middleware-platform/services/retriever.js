'use strict';

/**
 * Unified retrieval (X1 / B3–B4): `knowledge_chunks` is canonical (pair + mono + SKU slice);
 * `ingredient_rag_chunks` (029) supplements. No parallel `retrieval_chunks` table.
 *
 * B4 tier order after merge: knowledge_sku → knowledge_pair → knowledge_mono → rag.
 */

const { createProductSkuCatalog } = require('./product-sku-catalog');

const MAX_CHUNKS_PER_CONFLICT = 2;
const MAX_TOTAL_CHUNKS = 8;

const EVID_ORDER = `CASE evidence_level
  WHEN 'established' THEN 3
  WHEN 'probable' THEN 2
  WHEN 'contested' THEN 1
  ELSE 0 END DESC`;

function _norm(id) {
  return String(id || '').replace(/^cosing:/, '').trim().toLowerCase();
}
function _cosing(id) {
  const n = _norm(id);
  return n ? `cosing:${n}` : '';
}
function _key(a, b) {
  const na = _norm(a);
  const nb = _norm(b);
  return na < nb ? `cosing:${na}|cosing:${nb}` : `cosing:${nb}|cosing:${na}`;
}

const TIER_SKU = 4;
const TIER_PAIR = 3;
const TIER_MONO = 2;
const TIER_RAG = 1;

function _evidenceRank(level) {
  const m = { established: 3, probable: 2, contested: 1 };
  return m[String(level || '').toLowerCase()] || 0;
}

/** B4: SKU-scoped knowledge → pair → monograph → ingredient_rag */
function _chunkTier(ch) {
  if (ch.chunk_source_tier === 'knowledge_sku') return TIER_SKU;
  if (ch.chunk_source_tier === 'rag') return TIER_RAG;
  if (ch.chunk_source_tier === 'knowledge_pair') return TIER_PAIR;
  if (ch.chunk_source_tier === 'knowledge_mono') return TIER_MONO;
  if (String(ch.source || '') === 'ingredient_rag_chunks') return TIER_RAG;
  if (ch.ingredient_a && ch.ingredient_b) return TIER_PAIR;
  return TIER_MONO;
}

function _inferKnowledgeChunkTier(row) {
  if (row.sku || row.product_id) return 'knowledge_sku';
  if (row.ingredient_a && row.ingredient_b) return 'knowledge_pair';
  return 'knowledge_mono';
}

function _sortChunksByTierThenEvidence(chunks) {
  return [...chunks].sort((a, b) => {
    const td = _chunkTier(b) - _chunkTier(a);
    if (td !== 0) return td;
    return _evidenceRank(b.evidence_level) - _evidenceRank(a.evidence_level);
  });
}

function _hasIngredientRagChunks(db) {
  try {
    const row = db
      .prepare(
        "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='ingredient_rag_chunks' LIMIT 1"
      )
      .get();
    return Boolean(row && row.ok);
  } catch (_) {
    return false;
  }
}

function createRetriever(db) {
  const skuCatalog = createProductSkuCatalog(db);
  const ragEnabled = _hasIngredientRagChunks(db);
  const stmtRagByReason = ragEnabled
    ? db.prepare(`
        SELECT * FROM ingredient_rag_chunks
        WHERE reason_code = ?
        ORDER BY ${EVID_ORDER}
        LIMIT ?
      `)
    : null;
  const stmtRagByIngredient = ragEnabled
    ? db.prepare(`
        SELECT * FROM ingredient_rag_chunks
        WHERE ingredient_canonical_id = ? OR ingredient_canonical_id = ?
        ORDER BY ${EVID_ORDER}
        LIMIT ?
      `)
    : null;

  const stmtPair = db.prepare(`
    SELECT * FROM knowledge_chunks
    WHERE pair_key = ?
    ORDER BY ${EVID_ORDER}
    LIMIT ?
  `);

  const stmtIngredient = db.prepare(`
    SELECT * FROM knowledge_chunks
    WHERE (ingredient_a = ? OR ingredient_b = ?)
      AND ingredient_b IS NULL
    ORDER BY ${EVID_ORDER}
    LIMIT ?
  `);

  const stmtReasonCode = db.prepare(`
    SELECT * FROM knowledge_chunks
    WHERE reason_codes LIKE ?
    ORDER BY ${EVID_ORDER}
    LIMIT ?
  `);

  const stmtFts = db.prepare(`
    SELECT kc.* FROM knowledge_chunks_fts
    JOIN knowledge_chunks kc ON kc.id = knowledge_chunks_fts.id
    WHERE knowledge_chunks_fts MATCH ?
    LIMIT ?
  `);

  function _ragToChunk(row, supports) {
    const codes = row.reason_code ? [row.reason_code] : [];
    const text = row.title ? `${row.title}: ${row.body}` : row.body;
    return {
      id: row.id,
      ingredient_a: row.ingredient_canonical_id || null,
      ingredient_b: null,
      reason_codes: codes,
      text,
      source: row.source || 'ingredient_rag_chunks',
      evidence_level: row.evidence_level || 'probable',
      supports,
      chunk_source_tier: 'rag',
      product_id: null,
      sku: null,
    };
  }

  /**
   * B3 — SKU / product_id slice of knowledge_chunks for this pair_key.
   */
  function _fetchPairScoped(pairKey, productIds, skus, limit) {
    const pids = [...new Set((productIds || []).map((x) => String(x || '').trim()).filter(Boolean))];
    const skList = [...new Set((skus || []).map((x) => String(x || '').trim()).filter(Boolean))];
    if (!pids.length && !skList.length) return [];
    const parts = [];
    const params = [pairKey];
    if (pids.length) {
      parts.push(`product_id IN (${pids.map(() => '?').join(',')})`);
      params.push(...pids);
    }
    if (skList.length) {
      parts.push(`sku IN (${skList.map(() => '?').join(',')})`);
      params.push(...skList);
    }
    const sql = `
      SELECT * FROM knowledge_chunks
      WHERE pair_key = ? AND (${parts.join(' OR ')})
      ORDER BY ${EVID_ORDER}
      LIMIT ?
    `;
    params.push(limit);
    try {
      return db.prepare(sql).all(...params);
    } catch (_) {
      return [];
    }
  }

  function _fetchMonoScoped(cosingA, cosingB, productIds, skus, limit) {
    const pids = [...new Set((productIds || []).map((x) => String(x || '').trim()).filter(Boolean))];
    const skList = [...new Set((skus || []).map((x) => String(x || '').trim()).filter(Boolean))];
    if (!pids.length && !skList.length) return [];
    const parts = [];
    const params = [cosingA, cosingB];
    if (pids.length) {
      parts.push(`product_id IN (${pids.map(() => '?').join(',')})`);
      params.push(...pids);
    }
    if (skList.length) {
      parts.push(`sku IN (${skList.map(() => '?').join(',')})`);
      params.push(...skList);
    }
    const sql = `
      SELECT * FROM knowledge_chunks
      WHERE ingredient_b IS NULL
        AND (ingredient_a = ? OR ingredient_a = ?)
        AND (${parts.join(' OR ')})
      ORDER BY ${EVID_ORDER}
      LIMIT ?
    `;
    params.push(limit);
    try {
      return db.prepare(sql).all(...params);
    } catch (_) {
      return [];
    }
  }

  function _mergeRagForConflict(conflict, seen, totalRef) {
    if (!ragEnabled || totalRef.value >= MAX_TOTAL_CHUNKS) return;

    const supports = [conflict.ingredient_a, conflict.ingredient_b];
    const ca = _cosing(conflict.ingredient_a);
    const cb = _cosing(conflict.ingredient_b);

    const ragRows = stmtRagByIngredient.all(ca, cb, 4);
    for (const row of ragRows) {
      if (totalRef.value >= MAX_TOTAL_CHUNKS) break;
      if (seen.has(row.id)) continue;
      seen.set(row.id, _ragToChunk(row, supports));
      totalRef.value++;
    }

    const specificCodes = (conflict.reason_codes || []).filter(
      (c) => !c.startsWith('class:') && !c.startsWith('severity:') && !c.startsWith('evidence:')
    );
    for (const code of specificCodes.slice(0, 2)) {
      if (totalRef.value >= MAX_TOTAL_CHUNKS) break;
      const codeRows = stmtRagByReason.all(code, 2);
      for (const row of codeRows) {
        if (totalRef.value >= MAX_TOTAL_CHUNKS) break;
        if (seen.has(row.id)) continue;
        seen.set(row.id, _ragToChunk(row, supports));
        totalRef.value++;
      }
    }
  }

  function getChunksForVerdict(verdict, opts = {}) {
    const seen = new Map();
    const totalRef = { value: 0 };

    const wantPid = opts.productIds || opts.product_ids;
    const productIdsNorm = Array.isArray(wantPid)
      ? [...new Set(wantPid.map((x) => String(x || '').trim()).filter(Boolean))]
      : [];
    const extraSkus = Array.isArray(opts.skus)
      ? opts.skus.map((x) => String(x || '').trim()).filter(Boolean)
      : [];
    const catalogSkus = skuCatalog.listSkusByProductIds(productIdsNorm);
    const wantSkus = [...new Set([...extraSkus, ...catalogSkus])];

    for (const conflict of verdict.conflicts) {
      if (totalRef.value >= MAX_TOTAL_CHUNKS) break;

      const na = `cosing:${_norm(conflict.ingredient_a)}`;
      const nb = `cosing:${_norm(conflict.ingredient_b)}`;
      const pk = _key(na, nb);

      const scopedPair = _fetchPairScoped(pk, productIdsNorm, wantSkus, MAX_CHUNKS_PER_CONFLICT);
      for (const row of scopedPair) {
        if (totalRef.value >= MAX_TOTAL_CHUNKS) break;
        if (!seen.has(row.id)) {
          seen.set(row.id, _toChunk(row, [conflict.ingredient_a, conflict.ingredient_b]));
          totalRef.value++;
        }
      }

      const pairRows = stmtPair.all(pk, MAX_CHUNKS_PER_CONFLICT);
      for (const row of pairRows) {
        if (totalRef.value >= MAX_TOTAL_CHUNKS) break;
        if (!seen.has(row.id)) {
          seen.set(row.id, _toChunk(row, [conflict.ingredient_a, conflict.ingredient_b]));
          totalRef.value++;
        }
      }

      const specificCodes = (conflict.reason_codes || [])
        .filter((c) => !c.startsWith('class:') && !c.startsWith('severity:') && !c.startsWith('evidence:'));
      for (const code of specificCodes.slice(0, 2)) {
        if (totalRef.value >= MAX_TOTAL_CHUNKS) break;
        const codeRows = stmtReasonCode.all(`%${code}%`, 1);
        for (const row of codeRows) {
          if (!seen.has(row.id)) {
            seen.set(row.id, _toChunk(row, [conflict.ingredient_a, conflict.ingredient_b]));
            totalRef.value++;
          }
        }
      }

      if (totalRef.value < MAX_TOTAL_CHUNKS) {
        const monoScoped = _fetchMonoScoped(na, nb, productIdsNorm, wantSkus, 2);
        for (const row of monoScoped) {
          if (totalRef.value >= MAX_TOTAL_CHUNKS) break;
          if (!seen.has(row.id)) {
            seen.set(row.id, _toChunk(row, [conflict.ingredient_a, conflict.ingredient_b]));
            totalRef.value++;
          }
        }
      }

      _mergeRagForConflict(conflict, seen, totalRef);
    }

    let chunks = _sortChunksByTierThenEvidence([...seen.values()]);
    if (productIdsNorm.length) {
      const allow = new Set(productIdsNorm.map((x) => String(x)));
      chunks = chunks.filter((c) => !c.product_id || allow.has(String(c.product_id)));
    }

    return {
      chunks,
      chunk_ids: chunks.map((c) => c.id),
      coverage: _coverage(verdict.conflicts, chunks),
    };
  }

  function getChunksForIngredient(ingredientId) {
    const na = `cosing:${_norm(ingredientId)}`;
    const seen = new Map();
    for (const row of stmtIngredient.all(na, na, 5)) {
      seen.set(row.id, _toChunk(row, [ingredientId]));
    }
    if (ragEnabled) {
      for (const row of stmtRagByIngredient.all(na, na, 5)) {
        if (!seen.has(row.id)) seen.set(row.id, _ragToChunk(row, [ingredientId]));
      }
    }
    return _sortChunksByTierThenEvidence([...seen.values()]);
  }

  function getChunksForPair(a, b) {
    const pk = _key(a, b);
    return _sortChunksByTierThenEvidence(stmtPair.all(pk, 5).map((r) => _toChunk(r, [a, b])));
  }

  function searchChunks(query, limit = 5) {
    const safe = String(query || '').replace(/"/g, '').trim();
    if (!safe) return [];
    try {
      const rows = stmtFts.all(`"${safe}"`, limit);
      if (rows.length) return rows.map((r) => _toChunk(r, []));
      const tokens = safe.split(/\s+/).map((t) => `"${t}"`).join(' OR ');
      return stmtFts.all(tokens, limit).map((r) => _toChunk(r, []));
    } catch (_) {
      return [];
    }
  }

  /**
   * C2 — FTS first; merges vector backend hits when implemented (stub returns [] today).
   */
  async function searchChunksAsync(query, limit = 5) {
    const base = searchChunks(query, limit);
    let vec = [];
    try {
      const { createVectorRetriever } = require('./vector-retriever');
      vec = await createVectorRetriever().search(query, { limit });
    } catch (_) {
      vec = [];
    }
    if (!Array.isArray(vec) || !vec.length) return base;
    const seen = new Set(base.map((c) => c.id));
    const merged = [...base];
    for (const row of vec) {
      if (!row || !row.id || seen.has(row.id)) continue;
      merged.push({
        id: row.id,
        ingredient_a: null,
        ingredient_b: null,
        reason_codes: [],
        text: row.text || '',
        source: 'vector_stub',
        evidence_level: 'probable',
        supports: [],
        chunk_source_tier: 'rag',
        product_id: null,
        sku: null,
      });
      seen.add(row.id);
    }
    return merged.slice(0, limit);
  }

  function _toChunk(row, supportedIngredients) {
    let codes = [];
    try { codes = JSON.parse(row.reason_codes || '[]'); } catch (_) {}
    const tier = _inferKnowledgeChunkTier(row);
    return {
      id: row.id,
      ingredient_a: row.ingredient_a,
      ingredient_b: row.ingredient_b,
      reason_codes: codes,
      text: row.text,
      source: row.source,
      evidence_level: row.evidence_level,
      supports: supportedIngredients,
      chunk_source_tier: tier,
      product_id: row.product_id || null,
      sku: row.sku || null,
    };
  }

  function _coverage(conflicts, chunks) {
    return conflicts.map((c) => {
      const na = `cosing:${_norm(c.ingredient_a)}`;
      const nb = `cosing:${_norm(c.ingredient_b)}`;
      const want = _key(na, nb);
      const covered = chunks.some((ch) => {
        if (!ch.ingredient_a || !ch.ingredient_b) return false;
        const got = _key(ch.ingredient_a, ch.ingredient_b);
        return got === want;
      });
      return { pair: `${na}|${nb}`, covered };
    });
  }

  return {
    getChunksForVerdict,
    getChunksForIngredient,
    getChunksForPair,
    searchChunks,
    searchChunksAsync,
  };
}

module.exports = { createRetriever };
