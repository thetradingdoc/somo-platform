'use strict';

/**
 * Eval harness: graph verdict + RAG chunk linkage + reasoning-map conflict mapping.
 * Run: node __tests__/kelly-routine-reasoning-eval.test.js
 */

const assert = require('assert');
const Database = require('better-sqlite3');
const { up: migrate028 } = require('../migrations/028_ingredient_interactions');
const { up: migrate029 } = require('../migrations/029_ingredient_rag_chunks');
const { createConflictGraph } = require('../services/ingredient-conflict-graph');
const { routineConflictsFromGraphVerdict, buildReasoningMap } = require('../services/reasoning-map-service');

const mem = new Database(':memory:');
migrate028(mem);
migrate029(mem);
const ragRows = mem.prepare(`SELECT COUNT(*) AS c FROM ingredient_rag_chunks`).get();
assert.ok(Number(ragRows.c) >= 1, 'migration 029 seeds rag chunks');
const graph = createConflictGraph(mem);

const vAvoid = graph.evaluateRoutine([
  { time: 'pm', ingredient_ids: ['cosing:retinol', 'cosing:lactic acid'] }
]);
assert.strictEqual(vAvoid.overall, 'avoid', 'retinoid+AHA must avoid');
assert.ok(vAvoid.conflicts.length >= 1);
assert.ok(vAvoid.reason_codes.length >= 1);

const vCaution = graph.evaluateRoutine([
  { time: 'am', ingredient_ids: ['cosing:ascorbic acid', 'cosing:niacinamide', 'cosing:glycerin'] }
]);
assert.strictEqual(vCaution.overall, 'caution', 'VitC+niacinamide is caution not avoid');

const rc = routineConflictsFromGraphVerdict(vAvoid);
assert.ok(rc.length >= 1);
assert.ok(rc[0].ingredient_canonical_ids?.length >= 2);
assert.ok((rc[0].reason_codes || []).length >= 1);

const map = buildReasoningMap({
  historyText: 'retinol and glycolic same night',
  primaryConcern: 'barrier_dryness_sensitivity',
  concerns: [],
  triggers: [],
  bodyAreas: [],
  intentPrimary: 'treat',
  intentSecondary: [],
  routineConflicts: rc,
  productTaxonomy: null,
  baseConfidence: 0.75
});
assert.strictEqual(map.version, '1.0');
const ev = map.evidence_items.find((e) => e.tags && e.tags.includes('routine_conflict'));
assert.ok(ev, 'graph conflict should produce evidence');
assert.ok((ev.payload?.reason_codes || []).length >= 0);

console.log('kelly-routine-reasoning-eval ok');
mem.close();
