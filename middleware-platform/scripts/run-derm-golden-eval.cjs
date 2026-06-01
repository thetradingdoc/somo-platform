#!/usr/bin/env node
'use strict';

/**
 * Derm Q&A offline eval runner skeleton (Phase 6 P6.1).
 * Loads golden dataset and prints placeholder metrics until full pipeline wired.
 */
const path = require('path');
const fs = require('fs');

const goldenPath =
  process.env.DERM_GOLDEN_PATH ||
  path.join(__dirname, '../../Knowledge/eval/datasets/golden_stratified_slice_v1.json');

function main() {
  if (!fs.existsSync(goldenPath)) {
    console.error('Golden dataset not found:', goldenPath);
    process.exit(1);
  }
  const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  const items = Array.isArray(golden) ? golden : golden.examples || golden.items || [];
  console.log('[derm-eval] Loaded', items.length, 'golden examples from', goldenPath);
  console.log('[derm-eval] Full runner pending — wire triage → retrieve → generate per DERM_PATIENT_QA_REDDIT_PIPELINE_TODOS Phase 6');
  process.exit(0);
}

main();
