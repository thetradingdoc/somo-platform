'use strict';

/**
 * Curated monograph chunks for RAG keyed by canonical ingredient id and/or reason_code
 * (aligns with ingredient-conflict-graph reason_codes).
 */
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ingredient_rag_chunks (
      id              TEXT PRIMARY KEY,
      ingredient_canonical_id TEXT,
      reason_code     TEXT,
      title             TEXT NOT NULL,
      body              TEXT NOT NULL,
      source            TEXT,
      evidence_level    TEXT DEFAULT 'probable',
      created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_ingredient_rag_chunks_ing ON ingredient_rag_chunks(ingredient_canonical_id);
    CREATE INDEX IF NOT EXISTS idx_ingredient_rag_chunks_rc ON ingredient_rag_chunks(reason_code);
  `);

  const rows = [
    {
      id: 'chunk:retinoid_aha',
      ingredient_canonical_id: 'cosing:retinol',
      reason_code: 'class:retinoid',
      title: 'Retinoids with AHAs',
      body: 'Combining prescription-strength retinoids with glycolic/lactic acid in the same session often causes cumulative irritation and barrier compromise. Prefer alternate nights or separate AM/PM with barrier support.',
      source: 'internal_monograph_v1'
    },
    {
      id: 'chunk:bp_retinol',
      ingredient_canonical_id: 'cosing:benzoyl peroxide',
      reason_code: 'oxidation_conflict',
      title: 'Benzoyl peroxide and retinoids',
      body: 'Benzoyl peroxide can oxidize and inactivate many retinoid formulations when layered. Use on different nights or as directed by a clinician.',
      source: 'internal_monograph_v1'
    },
    {
      id: 'chunk:vit_c_niacinamide',
      ingredient_canonical_id: 'cosing:ascorbic acid',
      reason_code: 'evidence:contested',
      title: 'Vitamin C and niacinamide',
      body: 'Historical concern about complex formation; modern leave-on products at room temperature are often compatible. If irritation occurs, separate application by 10–15 minutes.',
      source: 'internal_monograph_v1'
    },
    {
      id: 'chunk:copper_vitc',
      ingredient_canonical_id: 'cosing:copper tripeptide-1',
      reason_code: 'efficacy_degradation',
      title: 'Copper peptides and vitamin C',
      body: 'Low-pH vitamin C can interfere with copper peptide stability. Many users separate AM (vitamin C) vs PM (peptide).',
      source: 'internal_monograph_v1'
    }
  ];

  const ins = db.prepare(`
    INSERT OR IGNORE INTO ingredient_rag_chunks
      (id, ingredient_canonical_id, reason_code, title, body, source, evidence_level)
    VALUES (?, ?, ?, ?, ?, ?, 'probable')
  `);

  for (const r of rows) {
    try {
      ins.run(r.id, r.ingredient_canonical_id || null, r.reason_code || null, r.title, r.body, r.source || null);
    } catch (_) {}
  }
}

function down(db) {
  db.exec('DROP TABLE IF EXISTS ingredient_rag_chunks');
}

module.exports = { up, down };
