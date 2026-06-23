'use strict';

const { searchNdcByName, searchNdcLoose } = require('../payor/openfda-ndc-service');
const { searchSplByDrugName } = require('../dailymed-spl-service');
const { normalizeDrugName } = require('../rxnorm-service');
const { mergeProductGrade } = require('./product-grade-merge');
const Metrics = require('../shared/metrics');

async function enrichProductRegulatorySignals(normalized) {
  const name = String(normalized?.product_name || '').trim();
  const brand = String((normalized?.brands || [])[0] || '').trim();
  const query = brand || name;
  const loose = name.split(/\s+/).slice(0, 2).join(' ') || name;

  const [fdaBrand, fdaLoose, dailymed, rxnorm] = await Promise.all([
    query ? searchNdcByName(query, 5) : Promise.resolve({ success: true, results: [] }),
    loose && loose !== query ? searchNdcLoose(loose, 5) : Promise.resolve({ success: true, results: [] }),
    name ? searchSplByDrugName(name, 3) : Promise.resolve({ success: false, spls: [] }),
    name ? normalizeDrugName(name) : Promise.resolve({ success: false, rxcui: null })
  ]);

  const fdaResults = [...(fdaBrand.results || []), ...(fdaLoose.results || [])];
  const seen = new Set();
  const deduped = [];
  for (const r of fdaResults) {
    const k = r.product_ndc || r.openfda?.product_ndc?.[0] || JSON.stringify(r).slice(0, 120);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(r);
  }
  const fda = { success: fdaBrand.success || fdaLoose.success, results: deduped.slice(0, 8) };

  if (fda.results.length) Metrics.increment('product_taxonomy.fda_ndc_hit.count', 1);
  else Metrics.increment('product_taxonomy.fda_ndc_miss.count', 1);
  if (dailymed.success && (dailymed.spls || []).length) Metrics.increment('product_taxonomy.dailymed_hit.count', 1);
  else Metrics.increment('product_taxonomy.dailymed_miss.count', 1);
  if (rxnorm.success && rxnorm.rxcui) Metrics.increment('product_taxonomy.rxnorm_hit.count', 1);
  else Metrics.increment('product_taxonomy.rxnorm_miss.count', 1);

  const merged = mergeProductGrade({ obfNormalized: normalized, fda, dailymed, rxnorm });
  Metrics.increment(`product_taxonomy.grade.${merged.grade_class}.count`, 1);
  return { fda, dailymed, rxnorm, merged };
}

module.exports = { enrichProductRegulatorySignals };
