#!/usr/bin/env node
'use strict';

/**
 * Build seed labeled gold dataset from pro-verified corpus.
 *
 * Usage:
 *   node scripts/build-skin-gold-dataset.js \
 *     --in ./tmp/pro_verified.jsonl \
 *     --out ./tmp/gold_skinmap_v1.jsonl
 */

const fs = require('fs');
const path = require('path');
const { resolveSkinType } = require('../services/clinical/skin-type-resolver');
const { resolveSkinConditions } = require('../services/shared/skin-condition-resolver');
const { resolveSkinConflicts } = require('../services/shared/skin-conflict-resolver');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--in') out.input = v;
    if (k === '--out') out.output = v;
  }
  return out;
}

function lines(file) {
  return fs.readFileSync(file, 'utf8').split('\n').map((x) => x.trim()).filter(Boolean);
}

function main() {
  const { input, output } = parseArgs(process.argv);
  if (!input || !output) {
    throw new Error('Missing --in or --out');
  }
  const inAbs = path.resolve(process.cwd(), input);
  const outAbs = path.resolve(process.cwd(), output);
  const rows = lines(inAbs);
  const labeled = [];
  for (const row of rows) {
    let obj = null;
    try { obj = JSON.parse(row); } catch (_) { continue; }
    const text = String(obj.text || obj.question || obj.body || '').trim();
    if (!text) continue;
    const skinType = resolveSkinType({ text, turnSeq: 1 });
    const skinCond = resolveSkinConditions({ text, skinType: skinType.value });
    const conflicts = resolveSkinConflicts({ message: text, conditions: skinCond.conditions });
    labeled.push({
      id: obj.id || obj.post_id || `seed_${labeled.length + 1}`,
      source: obj.source || 'reddit_pro_verified',
      text,
      labels: {
        skin_type: skinType.value,
        skin_condition: (skinCond.conditions || []).map((c) => ({ id: c.id, confidence: c.confidence })),
        pigment_risk: skinCond.secondary_signals?.pigment_risk || 'low',
        conflict_labels: conflicts.map((c) => c.id),
        next_action_class: conflicts.length ? 'conflict_clarify' : 'clarify_or_routine_guidance'
      },
      evidence: {
        skin_type: skinType.evidence || [],
        reason_codes: skinCond.reason_codes || []
      },
      needs_human_review: true
    });
  }
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, labeled.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8');
  process.stdout.write(`wrote ${labeled.length} rows to ${outAbs}\n`);
}

main();
