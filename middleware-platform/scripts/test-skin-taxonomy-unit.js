#!/usr/bin/env node
'use strict';

const { resolveSkinType } = require('../services/clinical/skin-type-resolver');
const { resolveSkinConditions } = require('../services/shared/skin-condition-resolver');
const { resolveBaumannCode } = require('../services/platform/baumann-skin-map-resolver');
const { resolveIngredientFacts, evaluateIngredientSafety } = require('../services/catalog/ingredient-ontology-resolver');

function assert(name, cond) {
  if (!cond) throw new Error(`Assertion failed: ${name}`);
}

function run() {
  const a = resolveSkinType({ text: 'I have oily t-zone and dry cheeks', turnSeq: 1 });
  assert('alias->combination', a.value === 'combination');

  const b = resolveSkinType({ text: 'I am not oily. Mostly dry.', turnSeq: 2 });
  assert('negation handling', b.value === 'dry' || b.value === 'unknown');

  const c = resolveSkinType({ text: 'my skin is normal and sensitive', turnSeq: 3 });
  assert('tie-break low/unknown', ['unknown', 'sensitive', 'normal'].includes(c.value));

  const d = resolveSkinType({
    text: 'actually correction i am dry not oily',
    turnSeq: 4,
    previous: { value: 'oily', status: 'confirmed' }
  });
  assert('correction status', ['corrected', 'confirmed', 'tentative'].includes(d.status));

  const e = resolveSkinConditions({ text: 'oily but tight and burning after cleanser', skinType: 'oily' });
  const condIds = (e.conditions || []).map((x) => x.id);
  assert('co-existence oily+dehydrated', condIds.includes('dehydrated'));
  assert('inflamed detected', condIds.includes('inflamed'));
  const f = resolveBaumannCode({
    skinType: 'oily',
    secondarySignals: { is_inflamed: true, pigment_risk: 'high', is_dehydrated: true }
  });
  assert('baumann code present', typeof f.code === 'string' && f.code.length === 4);
  assert('baumann confidence present', ['low', 'medium', 'high'].includes(f.confidence));
  assert('baumann dimension scores object', typeof f.dimension_scores === 'object');
  const ingFacts = resolveIngredientFacts('I use retinol and glycolic acid every night');
  assert('ingredient aliases resolved', ingFacts.length >= 2);
  const ingSafety = evaluateIngredientSafety({
    ingredientFacts: ingFacts,
    conditions: [{ id: 'inflamed' }, { id: 'barrier_compromised' }],
    secondarySignals: { pigment_risk: 'high' }
  });
  assert('ingredient safety warnings created', ingSafety.length >= 1);
  console.log('skin taxonomy unit tests: PASS');
}

run();
