/**
 * Skin & Care assessment — first-class columns on `triage_sessions`
 * =================================================================
 * TASK 22 DESIGN LOCK (Phase 2.5). Do not rename without a follow-up migration.
 * Product spec: docs/skincare-assessment-product-spec.md
 *
 * STORAGE CONTRACT
 * ----------------
 * All new fields are nullable until intake writes them.
 *
 * skin_type (TEXT, enum)
 *   Allowed: oily | dry | combination | normal | unsure | not_applicable | unknown | prefer_not_say
 *
 * skin_concerns_json (TEXT, JSON array)
 *   Schema: string[] — concern slugs or short labels, e.g. ["acne","dryness","hyperpigmentation"]
 *   Min length 1 when intake is complete (application rule; DB allows empty).
 *
 * pregnancy_status (TEXT, enum)
 *   Allowed: not_pregnant_not_bf | pregnant | breastfeeding | trying |
 *            prefer_not_say | unknown
 *
 * prior_dermatologist_json (TEXT, JSON object)
 *   Schema: { "seen": boolean | null, "note": string }
 *   "seen" null = not yet answered; false/true = answered.
 *
 * functional_impact (INTEGER)
 *   Scale 1–5: 1 = barely affects life, 5 = severely affects daily life. NULL = not collected.
 *
 * ingredient_reactions (TEXT)
 *   Free text: products/ingredients that stung, broke out, etc.
 *
 * what_has_worked (TEXT)
 *   Free text: positive history for retrieval.
 *
 * hormonal_context (TEXT, enum)
 *   Allowed: none | perimenopausal | postmenopausal | hormonal_contraception |
 *            recent_postpartum | prefer_not_say | unknown
 *   (No menstrual/LMP fields — life-stage / contraception / postpartum only.)
 *
 * lifestyle_notes (TEXT)
 *   Free text: sleep, stress, diet patterns, exercise, water — as one blob for v1.
 *
 * environment_notes (TEXT)
 *   Free text: climate, urban/rural, sun exposure, hard water, etc.
 *
 * triggers_json (TEXT, JSON array)
 *   Schema: string[] — e.g. ["stress","winter","after_sweating","unknown"]
 *
 * JSON columns: store JSON.stringify output; readers use safe parse.
 */

function addColumnIfMissing(db, table, colName, colDef) {
  try {
    const info = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!info.some((c) => c.name === colName)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colDef}`);
    }
  } catch (e) {
    console.warn(`[021] Add ${colName} to ${table}:`, e.message);
  }
}

function up(db) {
  const table = 'triage_sessions';
  addColumnIfMissing(db, table, 'skin_type', 'TEXT');
  addColumnIfMissing(db, table, 'skin_concerns_json', 'TEXT');
  addColumnIfMissing(db, table, 'pregnancy_status', 'TEXT');
  addColumnIfMissing(db, table, 'prior_dermatologist_json', 'TEXT');
  addColumnIfMissing(db, table, 'functional_impact', 'INTEGER');
  addColumnIfMissing(db, table, 'ingredient_reactions', 'TEXT');
  addColumnIfMissing(db, table, 'what_has_worked', 'TEXT');
  addColumnIfMissing(db, table, 'hormonal_context', 'TEXT');
  addColumnIfMissing(db, table, 'lifestyle_notes', 'TEXT');
  addColumnIfMissing(db, table, 'environment_notes', 'TEXT');
  addColumnIfMissing(db, table, 'triggers_json', 'TEXT');
}

function down(db) {
  // SQLite: no DROP COLUMN in older versions; leave columns.
}

module.exports = { up, down };
