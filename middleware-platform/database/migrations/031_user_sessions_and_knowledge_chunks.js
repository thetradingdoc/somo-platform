'use strict';

/**
 * Migration 031 — user_sessions + knowledge_chunks
 *
 * user_sessions  : persistent session state per user (goals, sensitivity, routine)
 * knowledge_chunks: curated evidence passages keyed by ingredient_id / pair / reason_code
 */

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id              TEXT PRIMARY KEY,
      skin_goals      TEXT NOT NULL DEFAULT '[]',
      sensitivity     TEXT NOT NULL DEFAULT 'none'
                        CHECK(sensitivity IN ('none','mild','moderate','severe')),
      contraindications TEXT NOT NULL DEFAULT '[]',
      current_routine TEXT NOT NULL DEFAULT '[]',
      scan_data       TEXT,
      journal_data    TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id            TEXT PRIMARY KEY,
      ingredient_a  TEXT,
      ingredient_b  TEXT,
      pair_key      TEXT GENERATED ALWAYS AS (
                      CASE
                        WHEN ingredient_a IS NOT NULL AND ingredient_b IS NOT NULL
                        THEN (
                          CASE WHEN ingredient_a < ingredient_b
                            THEN ingredient_a || '|' || ingredient_b
                            ELSE ingredient_b || '|' || ingredient_a
                          END
                        )
                        ELSE NULL
                      END
                    ) STORED,
      reason_codes  TEXT NOT NULL DEFAULT '[]',
      text          TEXT NOT NULL,
      source        TEXT NOT NULL DEFAULT 'internal',
      evidence_level TEXT NOT NULL DEFAULT 'established'
                      CHECK(evidence_level IN ('established','probable','contested')),
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_a        ON knowledge_chunks(ingredient_a);
    CREATE INDEX IF NOT EXISTS idx_chunks_b        ON knowledge_chunks(ingredient_b);
    CREATE INDEX IF NOT EXISTS idx_chunks_pair_key ON knowledge_chunks(pair_key);

    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts
      USING fts5(id UNINDEXED, text, reason_codes, content='knowledge_chunks', content_rowid='rowid');
  `);

  const chunks = [
    {
      id: 'retinol-aha-irritation-001',
      a: 'cosing:retinol', b: 'cosing:lactic acid',
      codes: ['irritation_amplification', 'class:retinoid', 'class:aha', 'severity:critical'],
      text: 'Retinol and alpha-hydroxy acids (AHAs) such as lactic acid both accelerate epidermal cell turnover and thin the stratum corneum. Applied in the same session, their combined exfoliative action substantially increases transepidermal water loss and the risk of contact dermatitis. Clinical guidance consistently recommends using retinoids and AHAs on alternate nights rather than simultaneously, allowing the barrier 24–48 hours to recover between exposures.',
      source: 'internal-monograph',
      evidence: 'established',
    },
    {
      id: 'retinol-aha-glycolic-001',
      a: 'cosing:retinol', b: 'cosing:glycolic acid',
      codes: ['irritation_amplification', 'class:retinoid', 'class:aha', 'severity:critical'],
      text: 'Glycolic acid (the smallest AHA) penetrates deeply and lowers skin surface pH to below 3.5 at effective concentrations. At this pH, retinol undergoes accelerated oxidative degradation, reducing its efficacy while simultaneously amplifying irritation. Formulations that combine glycolic acid and retinol are therefore doubly counterproductive: the AHA partially inactivates the retinoid while also increasing skin sensitivity to it.',
      source: 'internal-monograph',
      evidence: 'established',
    },
    {
      id: 'retinol-bha-salicylic-001',
      a: 'cosing:retinol', b: 'cosing:salicylic acid',
      codes: ['irritation_amplification', 'class:retinoid', 'class:bha', 'severity:critical'],
      text: 'Salicylic acid (BHA) at active concentrations (0.5–2%) works at pH below 3.5, dissolving intercellular lipids in the follicular canal. Retinol also works partly by normalising follicular keratinisation. Used together, they create a strong barrier-disruption synergy that is beneficial in neither direction: the BHA environment degrades retinol stability while compounding irritation. Separate to alternate nights; if both are clinically necessary, apply BHA in the morning and retinol at night.',
      source: 'internal-monograph',
      evidence: 'established',
    },
    {
      id: 'retinol-bp-oxidation-001',
      a: 'cosing:retinol', b: 'cosing:benzoyl peroxide',
      codes: ['oxidation_conflict', 'class:retinoid', 'class:antimicrobial_oxidant', 'severity:critical'],
      text: 'Benzoyl peroxide is a strong oxidising agent that cleaves the conjugated double-bond system of retinol, converting it to inactive retinol epoxide. The reaction occurs rapidly on skin contact, rendering the retinoid functionally inert. This interaction is well-documented and is one of the few absolute contraindications in topical combination therapy. Use benzoyl peroxide in the morning and retinol at night, or on strictly alternate nights if concurrent AM/PM use still shows irritation.',
      source: 'internal-monograph',
      evidence: 'established',
    },
    {
      id: 'tretinoin-bp-oxidation-001',
      a: 'cosing:tretinoin', b: 'cosing:benzoyl peroxide',
      codes: ['oxidation_conflict', 'class:retinoid', 'class:antimicrobial_oxidant', 'severity:critical'],
      text: 'Tretinoin (all-trans retinoic acid), the prescription-strength retinoid, is fully oxidised by benzoyl peroxide within minutes of co-application. Unlike retinol, which is a precursor, tretinoin is the biologically active acid form — its oxidative degradation produces compounds with no retinoid receptor activity. This incompatibility is noted in prescribing guidelines; patients should be explicitly counselled to apply the two products at different times of day.',
      source: 'internal-monograph',
      evidence: 'established',
    },
    {
      id: 'retinol-vitc-ph-001',
      a: 'cosing:retinol', b: 'cosing:ascorbic acid',
      codes: ['ph_incompatibility', 'class:retinoid', 'class:antioxidant', 'severity:high'],
      text: 'L-ascorbic acid (vitamin C) requires a formulation pH below 3.5 for adequate skin penetration; at this pH, retinol is both chemically unstable and more irritating to the skin. The practical solution is time-of-day separation: apply vitamin C in the morning (where its antioxidant action also protects against UV-induced oxidative damage) and retinol in the evening. An 8-hour gap effectively eliminates the pH overlap on skin surface.',
      source: 'internal-monograph',
      evidence: 'established',
    },
    {
      id: 'nia-vitc-contested-001',
      a: 'cosing:niacinamide', b: 'cosing:ascorbic acid',
      codes: ['efficacy_degradation', 'class:vitamin_b3', 'class:antioxidant', 'severity:moderate', 'evidence:contested'],
      text: 'Early in-vitro work raised concerns that niacinamide and ascorbic acid combine to form nicotinic acid (niacin), which can cause transient flushing. More recent analysis shows that significant nicotinic acid formation requires sustained high temperatures not encountered in normal skincare use. Contemporary dermatology literature considers the combination safe for most users. A 10–15 minute stagger between application of a high-dose vitamin C serum and niacinamide-containing moisturiser is a practical precaution for sensitive skin.',
      source: 'internal-monograph',
      evidence: 'contested',
    },
    {
      id: 'bp-vitc-oxidation-001',
      a: 'cosing:benzoyl peroxide', b: 'cosing:ascorbic acid',
      codes: ['oxidation_conflict', 'class:antimicrobial_oxidant', 'class:antioxidant', 'severity:high'],
      text: 'Benzoyl peroxide oxidises L-ascorbic acid directly, converting it to dehydroascorbic acid and then to diketogulonic acid — neither of which has meaningful antioxidant or collagen-synthesis activity. The vitamin C is effectively consumed by the peroxide before it can act on the skin. Vitamin C serums should be used exclusively in the morning; benzoyl peroxide treatments should be reserved for evening use.',
      source: 'internal-monograph',
      evidence: 'established',
    },
    {
      id: 'copper-vitc-chelation-001',
      a: 'cosing:copper tripeptide-1', b: 'cosing:ascorbic acid',
      codes: ['efficacy_degradation', 'class:copper_peptide', 'class:antioxidant', 'severity:high'],
      text: 'Ascorbic acid is a known chelating agent: it binds divalent metal ions including Cu²⁺, removing copper from the tripeptide-copper complex that gives copper peptides their wound-healing and collagen-stimulating activity. The chelation reduces copper peptide efficacy proportionally to the concentration of ascorbic acid present. Separate to different times of day (vitamin C AM, copper peptides PM) to preserve the activity of both actives.',
      source: 'internal-monograph',
      evidence: 'probable',
    },
    {
      id: 'aha-bha-barrier-001',
      a: 'cosing:glycolic acid', b: 'cosing:salicylic acid',
      codes: ['barrier_disruption', 'class:aha', 'class:bha', 'severity:high'],
      text: 'AHAs exfoliate the skin surface by breaking desmosomes between corneocytes; BHAs additionally penetrate follicles to dissolve sebum plugs. At high concentrations, simultaneous use removes too many corneocytes in a single session, leaving the skin without adequate barrier protection. The result is acute barrier dysfunction — erythema, stinging, increased sensitivity — that takes 48–72 hours to resolve. At typical leave-on concentrations (≤5% AHA, ≤2% BHA), same-session use may be tolerable for non-sensitive skin types, but a minimum 4-hour stagger reduces cumulative irritation.',
      source: 'internal-monograph',
      evidence: 'established',
    },
    {
      id: 'retinol-mechanism-001',
      a: 'cosing:retinol', b: null,
      codes: ['class:retinoid'],
      text: 'Retinol is a vitamin A derivative that must be converted by skin enzymes to retinaldehyde and then to retinoic acid (the active form) before it can bind retinoid receptors. This conversion step means retinol is less potent than prescription tretinoin but also less irritating. Key effects: increased epidermal cell turnover, stimulation of collagen synthesis, and normalisation of follicular keratinisation. Retinol is photosensitive and should be stored away from light; PM-only application is standard.',
      source: 'internal-monograph',
      evidence: 'established',
    },
    {
      id: 'niacinamide-mechanism-001',
      a: 'cosing:niacinamide', b: null,
      codes: ['class:vitamin_b3'],
      text: 'Niacinamide (vitamin B3) is a water-soluble vitamin with multiple cutaneous effects: it inhibits melanosome transfer to keratinocytes (brightening), strengthens the skin barrier by increasing ceramide synthesis, reduces transepidermal water loss, and has mild sebum-regulatory effects. It is pH-tolerant (effective across pH 4–8) and compatible with most other actives when used at 2–10%. Concentrations above 10% may occasionally cause flushing in sensitive individuals.',
      source: 'internal-monograph',
      evidence: 'established',
    },
    {
      id: 'vitc-mechanism-001',
      a: 'cosing:ascorbic acid', b: null,
      codes: ['class:antioxidant'],
      text: 'L-ascorbic acid is the most bioavailable form of vitamin C in topical formulations. It scavenges reactive oxygen species, regenerates vitamin E, and is an essential co-factor for prolyl and lysyl hydroxylase enzymes in collagen synthesis. Efficacy requires pH below 3.5 and concentrations of 10–20%. At higher pH or in the presence of oxidants (light, air, metal ions), ascorbic acid rapidly degrades to yellow-coloured oxidation products with minimal skin benefit.',
      source: 'internal-monograph',
      evidence: 'established',
    },
  ];

  const ins = db.prepare(`
    INSERT OR IGNORE INTO knowledge_chunks
      (id, ingredient_a, ingredient_b, reason_codes, text, source, evidence_level)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const c of chunks) {
    try {
      ins.run(
        c.id,
        c.a || null,
        c.b || null,
        JSON.stringify(c.codes),
        c.text,
        c.source,
        c.evidence,
      );
    } catch (_) {}
  }

  try {
    db.exec(`INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts) VALUES('rebuild')`);
  } catch (_) {}
}

function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS knowledge_chunks_fts;
    DROP TABLE IF EXISTS knowledge_chunks;
    DROP TABLE IF EXISTS user_sessions;
  `);
}

module.exports = { up, down };
