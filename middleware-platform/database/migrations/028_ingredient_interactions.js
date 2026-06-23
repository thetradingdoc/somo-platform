'use strict';

/**
 * Migration 028 — ingredient_interactions graph
 *
 * Stores directed edges between canonical ingredient IDs.
 * Seed data covers the highest-severity, most evidence-backed conflicts only.
 *
 * interaction_type values (exhaustive list for v1):
 *   irritation_amplification  — together significantly increase skin irritation
 *   efficacy_degradation      — one degrades / inactivates the other
 *   ph_incompatibility        — pH ranges are mutually exclusive; one denatures the other
 *   barrier_disruption        — combination disrupts stratum corneum beyond safe threshold
 *   oxidation_conflict        — one oxidises / destabilises the other
 *
 * severity values: critical | high | moderate
 *   critical  → never combine; block in routine builder
 *   high      → require spacing (hours noted) or separate AM/PM
 *   moderate  → caution, surface in UI but do not block
 *
 * direction: edges are stored BOTH ways where symmetric so lookups only need
 *   "give me all edges for this ingredient_id" — no union needed at query time.
 */

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ingredient_interactions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ingredient_a    TEXT NOT NULL,
      ingredient_b    TEXT NOT NULL,
      interaction_type TEXT NOT NULL,
      severity        TEXT NOT NULL CHECK(severity IN ('critical','high','moderate')),
      direction       TEXT NOT NULL DEFAULT 'bidirectional'
                        CHECK(direction IN ('bidirectional','a_on_b')),
      spacing_hours   INTEGER,        -- minimum spacing if not outright blocked (null = block)
      notes           TEXT,
      evidence_level  TEXT NOT NULL DEFAULT 'established'
                        CHECK(evidence_level IN ('established','probable','contested')),
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_interactions_pair
      ON ingredient_interactions(ingredient_a, ingredient_b, interaction_type);

    CREATE INDEX IF NOT EXISTS idx_interactions_a
      ON ingredient_interactions(ingredient_a, severity);

    CREATE INDEX IF NOT EXISTS idx_interactions_b
      ON ingredient_interactions(ingredient_b, severity);
  `);

  /**
   * Seed: high-severity edges only.
   *
   * Ingredient keys must match canonical_inci / cosing:<inci_name> format used
   * in product_ingredients.ingredient_canonical_id.  For the seed we use the
   * bare INCI name (lower); the graph service normalises at query time.
   *
   * Each bidirectional pair is inserted twice so either direction is found with
   * a simple WHERE ingredient_a = ? query.
   */
  const edges = [
    // ─── Retinoids + AHAs ────────────────────────────────────────────────────
    {
      a: 'retinol', b: 'lactic acid',
      type: 'irritation_amplification', severity: 'critical',
      spacing: null,
      notes: 'Both exfoliate and raise skin cell turnover; combined use causes significant irritation and barrier damage. Use on alternate nights.',
      evidence: 'established',
    },
    {
      a: 'retinol', b: 'glycolic acid',
      type: 'irritation_amplification', severity: 'critical',
      spacing: null,
      notes: 'Glycolic acid (low pH) can accelerate retinol conversion but dramatically increases peeling and irritation. Avoid same session.',
      evidence: 'established',
    },
    {
      a: 'retinol', b: 'mandelic acid',
      type: 'irritation_amplification', severity: 'high',
      spacing: 24,
      notes: 'Mandelic acid is gentler than glycolic but still conflicts with retinol at standard concentrations.',
      evidence: 'probable',
    },
    // ─── Retinoids + BHAs ────────────────────────────────────────────────────
    {
      a: 'retinol', b: 'salicylic acid',
      type: 'irritation_amplification', severity: 'critical',
      spacing: null,
      notes: 'Salicylic acid (BHA) at effective pH (<3.5) destabilises retinol and amplifies peeling. Use PM only, separate nights.',
      evidence: 'established',
    },
    // ─── Retinoids + Vitamin C ────────────────────────────────────────────────
    {
      a: 'retinol', b: 'ascorbic acid',
      type: 'ph_incompatibility', severity: 'high',
      spacing: 8,
      notes: 'L-ascorbic acid is stable at pH <3.5; retinol oxidises in acidic environment. Apply Vit-C AM, retinol PM.',
      evidence: 'established',
    },
    // ─── Retinoids + Benzoyl Peroxide ────────────────────────────────────────
    {
      a: 'retinol', b: 'benzoyl peroxide',
      type: 'oxidation_conflict', severity: 'critical',
      spacing: null,
      notes: 'Benzoyl peroxide oxidises retinol, rendering it inactive. Never layer; use on alternate nights if both needed.',
      evidence: 'established',
    },
    {
      a: 'tretinoin', b: 'benzoyl peroxide',
      type: 'oxidation_conflict', severity: 'critical',
      spacing: null,
      notes: 'Same mechanism as retinol; tretinoin (Rx retinoid) is fully deactivated by benzoyl peroxide.',
      evidence: 'established',
    },
    // ─── AHAs + BHAs (high concentration stacking) ───────────────────────────
    {
      a: 'glycolic acid', b: 'salicylic acid',
      type: 'barrier_disruption', severity: 'high',
      spacing: 4,
      notes: 'High-concentration stacking of AHA+BHA over-exfoliates. Low-dose leave-on combinations (toner level) are moderate risk only.',
      evidence: 'established',
    },
    {
      a: 'lactic acid', b: 'salicylic acid',
      type: 'barrier_disruption', severity: 'moderate',
      spacing: 4,
      notes: 'Lower irritation potential than glycolic+salicylic. Caution at >5% combined concentration.',
      evidence: 'established',
    },
    // ─── Vitamin C + Niacinamide ──────────────────────────────────────────────
    // NOTE: evidence is contested; historically claimed to form niacin but modern
    // research suggests it requires high temperature for significant conversion.
    // Included as 'moderate/contested' — surface caution, do not block.
    {
      a: 'ascorbic acid', b: 'niacinamide',
      type: 'efficacy_degradation', severity: 'moderate',
      spacing: 0,
      notes: 'Historical concern: niacin/flushing from nicotinic acid formation. Modern formulations at ambient temp show minimal conversion. Separate by 10–15 min if using high-dose vitamin C serum.',
      evidence: 'contested',
    },
    // ─── Vitamin C + AHAs (pH destabilisation) ───────────────────────────────
    {
      a: 'ascorbic acid', b: 'glycolic acid',
      type: 'efficacy_degradation', severity: 'high',
      spacing: 8,
      notes: 'Both require low pH; usable together in AM but glycolic acid can accelerate ascorbic acid oxidation over time. Better in separate steps.',
      evidence: 'probable',
    },
    // ─── Benzoyl Peroxide + Vitamin C ────────────────────────────────────────
    {
      a: 'benzoyl peroxide', b: 'ascorbic acid',
      type: 'oxidation_conflict', severity: 'high',
      spacing: 8,
      notes: 'Benzoyl peroxide oxidises ascorbic acid, reducing efficacy. Use vitamin C in AM only, benzoyl peroxide in PM.',
      evidence: 'established',
    },
    // ─── Benzoyl Peroxide + AHAs ─────────────────────────────────────────────
    {
      a: 'benzoyl peroxide', b: 'glycolic acid',
      type: 'irritation_amplification', severity: 'high',
      spacing: 4,
      notes: 'Combined use on sensitive or acne-prone skin significantly increases irritation and dryness.',
      evidence: 'established',
    },
    // ─── Copper peptides + Vitamin C ─────────────────────────────────────────
    {
      a: 'copper tripeptide-1', b: 'ascorbic acid',
      type: 'efficacy_degradation', severity: 'high',
      spacing: 8,
      notes: 'Ascorbic acid chelates copper ions, reducing peptide efficacy. Use copper peptides PM, vitamin C AM.',
      evidence: 'probable',
    },
    // ─── Copper peptides + AHAs ──────────────────────────────────────────────
    {
      a: 'copper tripeptide-1', b: 'glycolic acid',
      type: 'efficacy_degradation', severity: 'high',
      spacing: 8,
      notes: 'Low pH environment from AHAs destabilises copper peptide complex.',
      evidence: 'probable',
    },
    // ─── Tretinoin + AHAs ────────────────────────────────────────────────────
    {
      a: 'tretinoin', b: 'lactic acid',
      type: 'irritation_amplification', severity: 'critical',
      spacing: null,
      notes: 'Prescription retinoid; AHA combination is contraindicated. Separate to alternate nights minimum.',
      evidence: 'established',
    },
    {
      a: 'tretinoin', b: 'glycolic acid',
      type: 'irritation_amplification', severity: 'critical',
      spacing: null,
      notes: 'Prescription retinoid + AHA: high irritation and barrier compromise risk.',
      evidence: 'established',
    },
    {
      a: 'tretinoin', b: 'salicylic acid',
      type: 'irritation_amplification', severity: 'critical',
      spacing: null,
      notes: 'Prescription retinoid + BHA: same-night use contraindicated.',
      evidence: 'established',
    },
  ];

  const ins = db.prepare(`
    INSERT OR IGNORE INTO ingredient_interactions
      (ingredient_a, ingredient_b, interaction_type, severity, direction, spacing_hours, notes, evidence_level)
    VALUES (?, ?, ?, ?, 'bidirectional', ?, ?, ?)
  `);

  const insertPair = db.transaction((edge) => {
    ins.run(edge.a, edge.b, edge.type, edge.severity, edge.spacing, edge.notes, edge.evidence);
    // Reverse direction so queries on either ingredient find the edge
    ins.run(edge.b, edge.a, edge.type, edge.severity, edge.spacing, edge.notes, edge.evidence);
  });

  for (const edge of edges) {
    try { insertPair(edge); } catch (_) {}
  }
}

function down(db) {
  db.exec('DROP TABLE IF EXISTS ingredient_interactions');
}

module.exports = { up, down };
