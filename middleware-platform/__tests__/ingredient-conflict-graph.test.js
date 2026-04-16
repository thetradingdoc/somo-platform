'use strict';

/**
 * __tests__/ingredient-conflict-graph.test.js
 *
 * Tests for services/ingredient-conflict-graph.js
 * Run: node __tests__/ingredient-conflict-graph.test.js
 *
 * Uses an in-memory SQLite DB seeded with migration 028.
 * Requires better-sqlite3.
 */

const Database = require('better-sqlite3');
const { up: migrate028 } = require('../migrations/028_ingredient_interactions');
const { createConflictGraph } = require('../services/ingredient-conflict-graph');

// ─── harness ──────────────────────────────────────────────────────────────────
let _passed = 0;
let _failed = 0;
const _failures = [];

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓  ${label}`);
    _passed++;
  } catch (err) {
    console.log(`  ✗  ${label}`);
    console.log(`       ${err.message}`);
    _failed++;
    _failures.push({ label, message: err.message });
  }
}

function section(name) {
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}`);
}

// ─── in-memory DB + seed ──────────────────────────────────────────────────────
const db = new Database(':memory:');
migrate028(db);
const graph = createConflictGraph(db);

// ─── helpers ──────────────────────────────────────────────────────────────────
const retinol = 'cosing:retinol';
const tretinoin = 'cosing:tretinoin';
const lacticAcid = 'cosing:lactic acid';
const glycolicAcid = 'cosing:glycolic acid';
const salicylicAcid = 'cosing:salicylic acid';
const ascorbicAcid = 'cosing:ascorbic acid';
const niacinamide = 'cosing:niacinamide';
const benzylPeroxide = 'cosing:benzoyl peroxide';
const copperPeptide = 'cosing:copper tripeptide-1';
const glycerin = 'cosing:glycerin'; // no conflicts — safe ingredient
const hyaluronicAcid = 'cosing:hyaluronic acid'; // no conflicts — safe ingredient

// ═══════════════════════════════════════════════════════════════════════════════
// 1. checkPair
// ═══════════════════════════════════════════════════════════════════════════════
section('checkPair — known conflicts');

test('retinol + lactic acid → critical', () => {
  const hit = graph.checkPair(retinol, lacticAcid);
  if (!hit) throw new Error('expected a conflict hit, got null');
  if (hit.severity !== 'critical') throw new Error(`expected critical, got ${hit.severity}`);
  if (hit.verdict !== 'avoid') throw new Error(`expected avoid, got ${hit.verdict}`);
});

test('retinol + glycolic acid → critical', () => {
  const hit = graph.checkPair(retinol, glycolicAcid);
  if (!hit) throw new Error('no hit');
  if (hit.severity !== 'critical') throw new Error(`severity: ${hit.severity}`);
});

test('retinol + salicylic acid → critical', () => {
  const hit = graph.checkPair(retinol, salicylicAcid);
  if (!hit) throw new Error('no hit');
  if (hit.severity !== 'critical') throw new Error(`severity: ${hit.severity}`);
});

test('retinol + benzoyl peroxide → critical', () => {
  const hit = graph.checkPair(retinol, benzylPeroxide);
  if (!hit) throw new Error('no hit');
  if (hit.severity !== 'critical') throw new Error(`severity: ${hit.severity}`);
});

test('tretinoin + benzoyl peroxide → critical', () => {
  const hit = graph.checkPair(tretinoin, benzylPeroxide);
  if (!hit) throw new Error('no hit');
  if (hit.severity !== 'critical') throw new Error(`severity: ${hit.severity}`);
});

test('retinol + ascorbic acid → high (pH incompatibility)', () => {
  const hit = graph.checkPair(retinol, ascorbicAcid);
  if (!hit) throw new Error('no hit');
  if (hit.severity !== 'high') throw new Error(`expected high, got ${hit.severity}`);
  if (hit.verdict !== 'caution') throw new Error(`verdict: ${hit.verdict}`);
  if (hit.spacing_hours === null) throw new Error('expected spacing_hours for separable pair');
});

test('ascorbic acid + niacinamide → moderate (contested)', () => {
  const hit = graph.checkPair(ascorbicAcid, niacinamide);
  if (!hit) throw new Error('no hit');
  if (hit.severity !== 'moderate') throw new Error(`severity: ${hit.severity}`);
  if (hit.evidence_level !== 'contested') throw new Error(`evidence: ${hit.evidence_level}`);
  if (hit.verdict !== 'info') throw new Error(`verdict: ${hit.verdict}`);
});

test('copper peptide + ascorbic acid → high', () => {
  const hit = graph.checkPair(copperPeptide, ascorbicAcid);
  if (!hit) throw new Error('no hit');
  if (hit.severity !== 'high') throw new Error(`severity: ${hit.severity}`);
});

section('checkPair — symmetry');

test('pair lookup works in both directions (a→b and b→a)', () => {
  const ab = graph.checkPair(retinol, lacticAcid);
  const ba = graph.checkPair(lacticAcid, retinol);
  if (!ab) throw new Error('a→b returned null');
  if (!ba) throw new Error('b→a returned null');
  if (ab.severity !== ba.severity) throw new Error('severity differs by direction');
});

test('self-check returns null', () => {
  const hit = graph.checkPair(retinol, retinol);
  if (hit !== null) throw new Error(`expected null for self-check, got ${JSON.stringify(hit)}`);
});

test('safe pair returns null', () => {
  const hit = graph.checkPair(glycerin, hyaluronicAcid);
  if (hit !== null) throw new Error('expected null for safe pair, got a hit');
});

section('checkPair — id normalisation');

test('bare INCI (no cosing: prefix) resolves correctly', () => {
  const hit = graph.checkPair('retinol', 'lactic acid');
  if (!hit) throw new Error('bare-key lookup failed');
  if (hit.severity !== 'critical') throw new Error(`severity: ${hit.severity}`);
});

test('mixed prefix / no-prefix resolves correctly', () => {
  const hit = graph.checkPair('cosing:retinol', 'lactic acid');
  if (!hit) throw new Error('mixed prefix lookup failed');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. buildBasket — multi-ingredient collision detection
// ═══════════════════════════════════════════════════════════════════════════════
section('buildBasket — conflict detection');

test('single-ingredient basket has no conflicts', () => {
  const { conflicts } = graph.buildBasket([retinol]);
  if (conflicts.length !== 0) throw new Error(`expected 0, got ${conflicts.length}`);
});

test('all-safe basket has no conflicts', () => {
  const { conflicts, safe_ids } = graph.buildBasket([glycerin, hyaluronicAcid, niacinamide]);
  // niacinamide has a moderate conflict with ascorbic acid but NOT with glycerin or HA
  if (conflicts.length !== 0) throw new Error(`expected 0, got ${conflicts.length}`);
  if (!safe_ids.includes('cosing:glycerin')) throw new Error('glycerin should be in safe_ids');
});

test('retinol + retinol deduplicated (no self-conflict)', () => {
  const { conflicts } = graph.buildBasket([retinol, retinol, lacticAcid]);
  // Should detect retinol↔lacticAcid only, not retinol↔retinol
  if (conflicts.some((c) => c.ingredient_a === c.ingredient_b)) {
    throw new Error('self-conflict should never appear in basket');
  }
  if (conflicts.length === 0) throw new Error('should have detected retinol+lactic acid');
});

test('conflicts sorted critical → high → moderate', () => {
  const { conflicts } = graph.buildBasket([
    retinol, lacticAcid,      // critical
    ascorbicAcid, niacinamide, // moderate
    retinol, ascorbicAcid,    // high
  ]);
  if (conflicts.length < 2) throw new Error('expected multiple conflicts');
  for (let i = 0; i < conflicts.length - 1; i++) {
    const a = conflicts[i];
    const b = conflicts[i + 1];
    const rank = { critical: 3, high: 2, moderate: 1 };
    if ((rank[a.severity] || 0) < (rank[b.severity] || 0)) {
      throw new Error(`sort error: ${a.severity} before ${b.severity}`);
    }
  }
});

test('safe_ids excludes conflicted ingredients', () => {
  const { safe_ids } = graph.buildBasket([retinol, lacticAcid, glycerin]);
  if (safe_ids.includes('cosing:retinol')) throw new Error('retinol should not be in safe_ids');
  if (safe_ids.includes('cosing:lactic acid')) throw new Error('lactic acid should not be in safe_ids');
  if (!safe_ids.includes('cosing:glycerin')) throw new Error('glycerin should be in safe_ids');
});

section('buildBasket — reason_codes');

test('conflict hits include reason_codes array', () => {
  const { conflicts } = graph.buildBasket([retinol, lacticAcid]);
  const hit = conflicts[0];
  if (!Array.isArray(hit.reason_codes)) throw new Error('reason_codes not an array');
  if (hit.reason_codes.length === 0) throw new Error('reason_codes should not be empty');
});

test('retinoid+AHA hit has class:retinoid and class:aha codes', () => {
  const { conflicts } = graph.buildBasket([retinol, lacticAcid]);
  const hit = conflicts[0];
  if (!hit.reason_codes.includes('class:retinoid')) {
    throw new Error(`missing class:retinoid, got: ${hit.reason_codes}`);
  }
  if (!hit.reason_codes.includes('class:aha')) {
    throw new Error(`missing class:aha, got: ${hit.reason_codes}`);
  }
});

test('severity:critical reason code present on critical hit', () => {
  const { conflicts } = graph.buildBasket([retinol, lacticAcid]);
  const hit = conflicts[0];
  if (!hit.reason_codes.includes('severity:critical')) {
    throw new Error(`missing severity:critical, got: ${hit.reason_codes}`);
  }
});

test('evidence:contested code present on niacinamide + vitamin C', () => {
  const { conflicts } = graph.buildBasket([ascorbicAcid, niacinamide]);
  const hit = conflicts[0];
  if (!hit.reason_codes.includes('evidence:contested')) {
    throw new Error(`missing evidence:contested, got: ${hit.reason_codes}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. evaluateRoutine — Kelly's RoutineReasoning tool entry point
// ═══════════════════════════════════════════════════════════════════════════════
section('evaluateRoutine — overall verdict');

test('all-safe routine → overall: safe', () => {
  const v = graph.evaluateRoutine([
    { time: 'am', ingredient_ids: [glycerin, hyaluronicAcid] },
    { time: 'pm', ingredient_ids: [niacinamide] },
  ]);
  if (v.overall !== 'safe') throw new Error(`expected safe, got ${v.overall}`);
  if (v.conflicts.length !== 0) throw new Error('expected no conflicts');
});

test('critical conflict → overall: avoid', () => {
  const v = graph.evaluateRoutine([
    { time: 'pm', ingredient_ids: [retinol, lacticAcid] },
  ]);
  if (v.overall !== 'avoid') throw new Error(`expected avoid, got ${v.overall}`);
});

test('high conflict → overall: caution', () => {
  const v = graph.evaluateRoutine([
    { time: 'am', ingredient_ids: [retinol, ascorbicAcid] },
  ]);
  if (v.overall !== 'caution') throw new Error(`expected caution, got ${v.overall}`);
});

test('moderate-only conflict → overall: caution (surface but do not block)', () => {
  const v = graph.evaluateRoutine([
    { time: 'am', ingredient_ids: [ascorbicAcid, niacinamide] },
  ]);
  if (v.overall !== 'caution') throw new Error(`expected caution, got ${v.overall}`);
  // Must not be 'avoid' for contested evidence
  if (v.overall === 'avoid') throw new Error('moderate/contested should not be avoid');
});

section('evaluateRoutine — eval set (nasty cases from backlog)');

test('NASTY: retinoid + acid (same PM session) → avoid', () => {
  // Kelly user scenario: tretinoin serum + AHA toner + BHA exfoliant all in PM
  const v = graph.evaluateRoutine([
    { time: 'pm', ingredient_ids: [tretinoin, glycolicAcid, salicylicAcid] },
  ]);
  if (v.overall !== 'avoid') throw new Error(`expected avoid for triple retinoid+AHA+BHA, got ${v.overall}`);
  const criticals = v.conflicts.filter((c) => c.severity === 'critical');
  if (criticals.length < 2) throw new Error(`expected ≥2 critical conflicts, got ${criticals.length}`);
});

test('NASTY: benzoyl peroxide + retinol + vitamin C → avoid', () => {
  // Triple conflict: BP oxidises both retinol and vitamin C
  const v = graph.evaluateRoutine([
    { time: 'am', ingredient_ids: [benzylPeroxide, retinol, ascorbicAcid] },
  ]);
  if (v.overall !== 'avoid') throw new Error(`expected avoid, got ${v.overall}`);
});

test('NASTY: complete 8-ingredient "kitchen sink" routine', () => {
  // Simulates user who dumped their entire shelf into one routine
  const v = graph.evaluateRoutine([
    { time: 'am', ingredient_ids: [ascorbicAcid, niacinamide, salicylicAcid, benzylPeroxide] },
    { time: 'pm', ingredient_ids: [retinol, lacticAcid, glycolicAcid, copperPeptide] },
  ]);
  if (v.overall !== 'avoid') throw new Error(`expected avoid, got ${v.overall}`);
  if (v.conflicts.length < 4) throw new Error(`expected ≥4 conflicts, got ${v.conflicts.length}`);
  if (v.reason_codes.length === 0) throw new Error('reason_codes should be populated for RAG');
});

test('NASTY: routine with only contested conflict (niacinamide + vitamin C) — should NOT block', () => {
  const v = graph.evaluateRoutine([
    { time: 'am', ingredient_ids: [ascorbicAcid, niacinamide, glycerin, hyaluronicAcid] },
  ]);
  if (v.overall === 'avoid') {
    throw new Error('contested evidence should not trigger avoid — would block a very common safe combo');
  }
});

test('vitamin C AM + retinol PM — no cross-time pairing (not same session)', () => {
  const v = graph.evaluateRoutine([
    { time: 'am', ingredient_ids: [ascorbicAcid] },
    { time: 'pm', ingredient_ids: [retinol] },
  ]);
  if (v.overall !== 'safe') throw new Error(`expected safe when times split, got ${v.overall}`);
  if (v.conflicts.length !== 0) throw new Error('expected no conflicts across AM/PM buckets');
});

test('wash_off step clears actives: BHA cleanser then retinol PM — no retinoid+BHA hit', () => {
  const v = graph.evaluateRoutine([
    {
      time: 'pm',
      step_order: 0,
      steps: [
        { order: 0, ingredient_ids: [salicylicAcid], wash_off: true, leave_on: false },
        { order: 1, ingredient_ids: [retinol], wash_off: false, leave_on: true },
      ],
    },
  ]);
  const bhaRet = v.conflicts.some(
    (c) =>
      (c.ingredient_a.includes('salicylic') || c.ingredient_b.includes('salicylic')) &&
      (c.ingredient_a.includes('retinol') || c.ingredient_b.includes('retinol'))
  );
  if (bhaRet) throw new Error('BHA in wash-off should not co-apply with retinol for conflict');
});

test('A6: outdoor leave-on adds context:outdoor_uv_actives for retinoid + acid', () => {
  const v = graph.evaluateRoutine([
    {
      time: 'pm',
      step_order: 0,
      steps: [
        {
          order: 0,
          ingredient_ids: [retinol],
          wash_off: false,
          leave_on: true,
          exposure: 'outdoor',
          role: 'serum',
        },
        {
          order: 1,
          ingredient_ids: [lacticAcid],
          wash_off: false,
          leave_on: true,
          exposure: 'outdoor',
          role: 'serum',
        },
      ],
    },
  ]);
  const hit = v.conflicts.find(
    (c) =>
      (c.ingredient_a.includes('retinol') || c.ingredient_b.includes('retinol')) &&
      (c.ingredient_a.includes('lactic') || c.ingredient_b.includes('lactic')),
  );
  if (!hit) throw new Error('expected retinol+lactic hit');
  if (!hit.context_tags.includes('context:outdoor_uv_actives')) {
    throw new Error(`expected outdoor_uv_actives, got ${JSON.stringify(hit.context_tags)}`);
  }
  if (hit.role_pair_impact == null) throw new Error('expected role_pair_impact');
});

test('A6: indoor-only retinoid + acid has empty context_tags', () => {
  const v = graph.evaluateRoutine([
    {
      time: 'pm',
      steps: [
        { order: 0, ingredient_ids: [retinol], exposure: 'indoor' },
        { order: 1, ingredient_ids: [lacticAcid], exposure: 'indoor' },
      ],
    },
  ]);
  const hit = v.conflicts.find(
    (c) =>
      (c.ingredient_a.includes('retinol') || c.ingredient_b.includes('retinol')) &&
      (c.ingredient_a.includes('lactic') || c.ingredient_b.includes('lactic')),
  );
  if (!hit) throw new Error('expected hit');
  if (hit.context_tags.length !== 0) {
    throw new Error(`expected no outdoor tags, got ${hit.context_tags}`);
  }
});

section('evaluateRoutine — JSON schema completeness');

test('verdict has all required top-level keys', () => {
  const v = graph.evaluateRoutine([{ time: 'am', ingredient_ids: [glycerin] }]);
  const required = ['overall', 'conflicts', 'reason_codes', 'safe_ids', 'suggested_split'];
  for (const k of required) {
    if (!Object.prototype.hasOwnProperty.call(v, k)) {
      throw new Error(`missing key: ${k}`);
    }
  }
});

test('conflict hit has all required keys', () => {
  const v = graph.evaluateRoutine([
    { time: 'pm', ingredient_ids: [retinol, lacticAcid] },
  ]);
  const hit = v.conflicts[0];
  const required = [
    'ingredient_a', 'ingredient_b', 'interaction_type', 'severity',
    'spacing_hours', 'notes', 'evidence_level', 'verdict', 'reason_codes',
    'context_tags', 'role_pair_impact',
  ];
  for (const k of required) {
    if (!Object.prototype.hasOwnProperty.call(hit, k)) {
      throw new Error(`conflict hit missing key: ${k}`);
    }
  }
});

test('safe routine has empty conflicts array (not null/undefined)', () => {
  const v = graph.evaluateRoutine([{ time: 'am', ingredient_ids: [glycerin] }]);
  if (!Array.isArray(v.conflicts)) throw new Error('conflicts should be an array');
  if (v.conflicts.length !== 0) throw new Error('expected empty conflicts');
});

test('suggested_split is null when no separable (spacing) conflicts', () => {
  // Critical conflicts have spacing_hours = null → no AM/PM split possible
  const v = graph.evaluateRoutine([
    { time: 'pm', ingredient_ids: [retinol, lacticAcid] },
  ]);
  if (v.suggested_split !== null) {
    throw new Error(`expected null suggested_split for critical (block) conflicts, got ${JSON.stringify(v.suggested_split)}`);
  }
});

test('suggested_split emitted for separable high-severity pair', () => {
  // retinol + ascorbic acid: severity=high, spacing_hours=8
  const v = graph.evaluateRoutine([
    { time: 'am', ingredient_ids: [retinol, ascorbicAcid, glycerin] },
  ]);
  if (v.overall === 'avoid') throw new Error('should be caution, not avoid');
  // suggested_split should provide AM/PM assignment
  if (v.suggested_split === null) {
    throw new Error('expected a suggested_split for separable high pair');
  }
  if (!Array.isArray(v.suggested_split.am) || !Array.isArray(v.suggested_split.pm)) {
    throw new Error('suggested_split should have am[] and pm[]');
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. getInteractionsFor
// ═══════════════════════════════════════════════════════════════════════════════
section('getInteractionsFor — ingredient detail API');

test('retinol has multiple interactions', () => {
  const hits = graph.getInteractionsFor(retinol);
  if (hits.length < 4) throw new Error(`expected ≥4 interactions for retinol, got ${hits.length}`);
});

test('severity filter works', () => {
  const criticals = graph.getInteractionsFor(retinol, 'critical');
  if (criticals.some((h) => h.severity !== 'critical')) {
    throw new Error('severity filter returned non-critical rows');
  }
});

test('safe ingredient returns empty array', () => {
  const hits = graph.getInteractionsFor(glycerin);
  if (hits.length !== 0) throw new Error(`expected 0 interactions for glycerin, got ${hits.length}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(66)}`);
console.log(`  Results: ${_passed} passed, ${_failed} failed`);

if (_failures.length) {
  console.log('\n  Failures:');
  _failures.forEach(({ label, message }) => {
    console.log(`    ✗  ${label}`);
    console.log(`         ${message}`);
  });
  process.exit(1);
}

db.close();
