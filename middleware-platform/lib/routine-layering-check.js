'use strict';

const ACTIVE_PATTERNS = [
  { id: 'retinol', re: /retinol|tretinoin|retinoid|adapalene|tazarotene/i },
  { id: 'salicylic acid', re: /salicylic|bha\b/i },
  { id: 'glycolic acid', re: /glycolic|aha\b/i },
  { id: 'lactic acid', re: /lactic acid/i },
  { id: 'ascorbic acid', re: /ascorbic|vitamin c|l-ascorbic/i },
  { id: 'benzoyl peroxide', re: /benzoyl peroxide|benzoyl-peroxide/i },
  { id: 'niacinamide', re: /niacinamide/i },
];

function extractActivesFromSteps(steps) {
  const found = new Set();
  for (const step of steps || []) {
    const text = String(step?.product_name || step || '').trim();
    if (!text) continue;
    for (const p of ACTIVE_PATTERNS) {
      if (p.re.test(text)) found.add(p.id);
    }
  }
  return [...found];
}

function checkLayeringForActives(activeIds, graph) {
  const conflicts = [];
  for (let i = 0; i < activeIds.length; i += 1) {
    for (let j = i + 1; j < activeIds.length; j += 1) {
      const hit = graph.checkPair(activeIds[i], activeIds[j]);
      if (hit) {
        conflicts.push({
          ingredient_a: hit.ingredient_a,
          ingredient_b: hit.ingredient_b,
          severity: hit.severity,
          verdict: hit.verdict,
          notes: hit.notes,
        });
      }
    }
  }
  const overall =
    conflicts.some((c) => c.verdict === 'avoid')
      ? 'avoid'
      : conflicts.some((c) => c.verdict === 'caution')
        ? 'caution'
        : 'safe';
  return { overall, conflicts };
}

function ingredientGraphAvailable(db) {
  if (!db) return false;
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM ingredient_interactions').get();
    return Number(row?.n) > 0;
  } catch (_) {
    return false;
  }
}

function runLayeringCheck({ steps, db }) {
  const activeIds = extractActivesFromSteps(steps);
  if (activeIds.length < 2) {
    return { overall: 'safe', conflicts: [], actives_detected: activeIds };
  }
  if (!ingredientGraphAvailable(db)) {
    return {
      overall: 'unknown',
      conflicts: [],
      actives_detected: activeIds,
      graph_unavailable: true,
    };
  }
  try {
    const dbModule = require('../database');
    const graph = dbModule.createIngredientConflictGraph();
    return { ...checkLayeringForActives(activeIds, graph), actives_detected: activeIds };
  } catch (_) {
    return {
      overall: 'unknown',
      conflicts: [],
      actives_detected: activeIds,
      graph_unavailable: true,
    };
  }
}

module.exports = {
  extractActivesFromSteps,
  runLayeringCheck,
};
