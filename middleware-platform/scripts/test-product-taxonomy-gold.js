#!/usr/bin/env node
'use strict';

const { mergeProductGrade } = require('../services/product-grade-merge');

function assert(name, cond) {
  if (!cond) throw new Error(`FAIL: ${name}`);
}

function run() {
  const obf = { product_name: 'Test Cream', labels: [], categories: [], ingredients: [] };

  const otc = mergeProductGrade({
    obfNormalized: obf,
    fda: {
      success: true,
      results: [{ marketing_category: 'OTC', product_type: 'HUMAN OTC DRUG', brand_name: 'Test' }]
    },
    dailymed: { success: false, spls: [] },
    rxnorm: { success: false, rxcui: null }
  });
  assert('fda otc wins', otc.grade_class === 'OTC_DRUG' && otc.source_priority === 'fda_ndc');

  const rx = mergeProductGrade({
    obfNormalized: obf,
    fda: {
      success: true,
      results: [{ marketing_category: 'NDA', product_type: 'HUMAN PRESCRIPTION DRUG', brand_name: 'Test' }]
    },
    dailymed: { success: false, spls: [] },
    rxnorm: { success: true, rxcui: '123' }
  });
  assert('fda rx wins', rx.grade_class === 'MEDICAL_RX');

  process.env.PRODUCT_GRADE_ENFORCE = '1';
  const fdaRxVsDmOtc = mergeProductGrade({
    obfNormalized: obf,
    fda: {
      success: true,
      results: [{ marketing_category: 'NDA', product_type: 'HUMAN PRESCRIPTION DRUG' }]
    },
    dailymed: { success: true, spls: [{ title: 'OTC Label', setid: 'y', text: 'Drug Facts' }] },
    rxnorm: { success: false, rxcui: null }
  });
  assert('enforce prefers FDA RX over DailyMed OTC hint', fdaRxVsDmOtc.grade_class === 'MEDICAL_RX');
  delete process.env.PRODUCT_GRADE_ENFORCE;

  const dm = mergeProductGrade({
    obfNormalized: obf,
    fda: { success: true, results: [] },
    dailymed: { success: true, spls: [{ title: 'Label', setid: 'x', drug_facts: 'Drug Facts Active ingredient zinc' }] },
    rxnorm: { success: false, rxcui: null }
  });
  assert('dailymed drug facts -> otc', dm.grade_class === 'OTC_DRUG' && dm.source_priority === 'dailymed');

  console.log('product taxonomy gold (merge): PASS');
}

run();
