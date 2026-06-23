#!/usr/bin/env node
'use strict';

const { resolveSkinConditions } = require('../services/shared/skin-condition-resolver');

function assert(name, cond) {
  if (!cond) throw new Error(`Assertion failed: ${name}`);
}

function run() {
  const a = resolveSkinConditions({
    text: 'I am concerned about dark spots after acne.',
    skinType: 'oily',
    visionHint: 'V'
  });
  assert('pigment risk inferred', ['medium', 'high', 'low'].includes(a.secondary_signals.pigment_risk));
  assert('phototype hint enum', a.secondary_signals.phototype_hint === 'V');

  const b = resolveSkinConditions({
    text: 'No pigment concerns, just dryness.',
    skinType: 'dry',
    visionHint: 'INVALID'
  });
  assert('invalid vision hint ignored', b.secondary_signals.phototype_hint === null);
  console.log('skin taxonomy red-team checks: PASS');
}

run();
