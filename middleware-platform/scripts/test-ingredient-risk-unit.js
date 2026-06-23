#!/usr/bin/env node
'use strict';

const { resolveIngredientRisks } = require('../services/catalog/ingredient-risk-resolver');
const { resolveIngredientFacts } = require('../services/catalog/ingredient-ontology-resolver');

function assert(name, cond) {
  if (!cond) throw new Error(`FAIL: ${name}`);
}

function run() {
  const facts = resolveIngredientFacts('I use glycolic acid nightly');
  const risks = resolveIngredientRisks({
    ingredientFacts: facts,
    conditions: [{ id: 'inflamed' }],
    secondarySignals: { pigment_risk: 'high' }
  });
  assert('at least one risk row', risks.length >= 1);
  assert('mentions contraindication or pigment', /contraindicated|pigment/i.test(JSON.stringify(risks)));
  console.log('ingredient risk unit: PASS');
}

run();
