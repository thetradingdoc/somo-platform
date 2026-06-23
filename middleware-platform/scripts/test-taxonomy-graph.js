#!/usr/bin/env node
'use strict';

const { resolveTaxonomyGraphAction } = require('../services/catalog/taxonomy-graph-resolver');

function assert(name, cond) {
  if (!cond) throw new Error(`Assertion failed: ${name}`);
}

function run() {
  const mockRules = [
    {
      id: 'rule.over_exfoliation_guard',
      when_json: JSON.stringify({ conditions_any: ['inflamed', 'barrier_compromised'], ingredients_any: ['aha', 'bha', 'glycolic acid', 'retinoid'] }),
      then_json: JSON.stringify({ clarify_required: true, blocked: true, next_question: 'How often are you using these actives each week?' })
    },
    {
      id: 'rule.high_pigment_conservative',
      when_json: JSON.stringify({ pigment_risk_any: ['high'], ingredients_any: ['aha', 'glycolic acid', 'retinoid'] }),
      then_json: JSON.stringify({ clarify_required: true, blocked: false, next_question: 'Given pigment sensitivity risk, can we start with a gentle cadence?' })
    }
  ];
  const a = resolveTaxonomyGraphAction({
    db: null,
    rulesOverride: mockRules,
    conditions: [{ id: 'inflamed' }],
    ingredientFacts: [{ name: 'glycolic acid', roles: ['aha'] }],
    secondarySignals: { pigment_risk: 'medium' }
  });
  assert('graph rule for over-exfoliation', !!a && a.rule_id === 'rule.over_exfoliation_guard');

  const b = resolveTaxonomyGraphAction({
    db: null,
    rulesOverride: mockRules,
    conditions: [{ id: 'dehydrated' }],
    ingredientFacts: [{ name: 'retinoid', roles: ['active'] }],
    secondarySignals: { pigment_risk: 'high' }
  });
  assert('graph rule for high pigment conservative', !!b && !!b.next_question);

  console.log('taxonomy graph tests: PASS');
}

run();
