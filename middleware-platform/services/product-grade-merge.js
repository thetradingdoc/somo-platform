'use strict';

const { resolveProductGrade } = require('./product-grade-resolver');
const { bestGradeFromResults } = require('./openfda-ndc-service');
const { splSuggestsDrugFacts } = require('./dailymed-spl-service');

const PRIORITY = { FDA_NDC: 100, DAILYMED: 80, RXNORM: 40, OBF_HEURISTIC: 20 };

/**
 * Merge regulatory signals: FDA NDC > DailyMed Drug Facts hint > RxNorm (naming only) > OBF text heuristics.
 * @param {object} opts
 * @param {object} opts.obfNormalized - normalized OBF product
 * @param {object} opts.fda - { success, results }
 * @param {object} opts.dailymed - { success, spls }
 * @param {object} opts.rxnorm - { success, rxcui }
 */
function mergeProductGrade({ obfNormalized, fda, dailymed, rxnorm }) {
  const obfGrade = resolveProductGrade({
    productName: obfNormalized?.product_name,
    labels: obfNormalized?.labels || [],
    categories: obfNormalized?.categories || [],
    ingredients: obfNormalized?.ingredients || []
  });

  const layers = [];

  if (fda?.success && Array.isArray(fda.results) && fda.results.length) {
    const g = bestGradeFromResults(fda.results);
    if (g) {
      layers.push({
        source: 'fda_ndc',
        priority: PRIORITY.FDA_NDC,
        grade_class: g.grade_class,
        confidence: g.confidence,
        regulatory_basis_json: { rationale: g.rationale, result_count: fda.results.length }
      });
    }
  }

  if (dailymed?.success && Array.isArray(dailymed.spls)) {
    const hasFacts = dailymed.spls.some((s) => splSuggestsDrugFacts(s));
    if (hasFacts) {
      layers.push({
        source: 'dailymed',
        priority: PRIORITY.DAILYMED,
        grade_class: 'OTC_DRUG',
        confidence: 'medium',
        regulatory_basis_json: { rationale: ['dailymed_spl_drug_facts_signal'] }
      });
    }
  }

  const rxMeta = rxnorm?.success && rxnorm.rxcui ? { rxcui: rxnorm.rxcui } : null;

  layers.push({
    source: 'open_beauty_facts',
    priority: PRIORITY.OBF_HEURISTIC,
    grade_class: obfGrade.grade_class,
    confidence: obfGrade.confidence,
    regulatory_basis_json: { rationale: obfGrade.rationale, source: 'resolver_v1' }
  });

  const graded = layers.filter((l) => l.grade_class);
  graded.sort((a, b) => b.priority - a.priority);

  const enforce = String(process.env.PRODUCT_GRADE_ENFORCE || '0') === '1';
  let winner = graded[0];
  if (!winner) {
    winner = {
      source: 'fallback',
      priority: 0,
      grade_class: 'GENERAL_COSMETIC',
      confidence: 'low',
      regulatory_basis_json: { rationale: ['no_layer_matched'] }
    };
  }

  if (enforce) {
    const fdaLayer = graded.find((l) => l.source === 'fda_ndc');
    if (fdaLayer) winner = fdaLayer;
    else {
      const dm = graded.find((l) => l.source === 'dailymed' && l.grade_class === 'OTC_DRUG');
      if (dm) winner = dm;
    }
  }

  const drugFactsPresent =
    winner.grade_class === 'OTC_DRUG' || graded.some((l) => l.source === 'dailymed' && l.grade_class === 'OTC_DRUG') ? 1 : 0;

  const regulatory_basis_json = {
    winner,
    layers: layers.map((l) => ({
      source: l.source,
      priority: l.priority,
      grade_class: l.grade_class,
      confidence: l.confidence
    })),
    rxnorm: rxMeta
  };

  return {
    grade_class: winner.grade_class,
    confidence: winner.confidence,
    source_priority: winner.source,
    regulatory_basis_json,
    drug_facts_present: drugFactsPresent,
    distribution_channel: winner.grade_class === 'PROFESSIONAL' ? 'clinic' : 'retail'
  };
}

module.exports = { mergeProductGrade, PRIORITY };
