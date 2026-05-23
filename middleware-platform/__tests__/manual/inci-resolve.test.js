'use strict';

/**
 * __tests__/inci-resolve.test.js
 * Run: node __tests__/inci-resolve.test.js
 */

const assert = require('assert');
const {
  parseInciText,
  resolveInciToken,
  resolveInciTextToRows,
  _levenshtein,
  _stripParenthetical,
  _isNoise
} = require('../../services/inci-resolve');

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

// ─── mock deps ────────────────────────────────────────────────────────────────
const COSING_DB = new Map([
  ['water', { inci_name: 'water' }],
  ['aqua', { inci_name: 'aqua' }],
  ['glycerin', { inci_name: 'glycerin' }],
  ['niacinamide', { inci_name: 'niacinamide' }],
  ['ascorbic acid', { inci_name: 'ascorbic acid' }],
  ['salicylic acid', { inci_name: 'salicylic acid' }],
  ['retinol', { inci_name: 'retinol' }],
  ['lactic acid', { inci_name: 'lactic acid' }],
  ['hyaluronic acid', { inci_name: 'hyaluronic acid' }]
]);
const ALL_CANDIDATES = [...COSING_DB.keys()];

const ALIAS_DB = new Map([
  ['vitamin b3', 'niacinamide'],
  ['vitamin b 3', 'niacinamide'],
  ['b3', 'niacinamide'],
  ['vitamin c', 'ascorbic acid'],
  ['l-ascorbic acid', 'ascorbic acid'],
  ['bha', 'salicylic acid'],
  ['vitamin a', 'retinol']
]);

const ALIAS_DB_WITH_UNVERIFIED = new Map([
  ...ALIAS_DB,
  ['xyz-complex', 'some-exotic-inci-not-in-cosing']
]);

const deps = {
  getCosingIngredientByInci: (n) => COSING_DB.get(n) || null,
  getAliasCanonical: (n) => ALIAS_DB.get(n) || null,
  cosingCandidates: ALL_CANDIDATES
};
const depsNoFuzzy = {
  getCosingIngredientByInci: (n) => COSING_DB.get(n) || null,
  getAliasCanonical: (n) => ALIAS_DB.get(n) || null
};
const depsWithUnverified = {
  ...deps,
  getAliasCanonical: (n) => ALIAS_DB_WITH_UNVERIFIED.get(n) || null
};

// ═══════════════════════════════════════════════════════════════════════════════
section('unit helpers');
test('levenshtein identical → 0', () => assert.strictEqual(_levenshtein('abc', 'abc'), 0));
test('levenshtein single deletion', () => assert.strictEqual(_levenshtein('glycerin', 'glcerin'), 1));
test('levenshtein single substitution', () => assert.strictEqual(_levenshtein('water', 'waxer'), 1));
test('stripParenthetical trailing paren', () =>
  assert.strictEqual(_stripParenthetical('niacinamide (vitamin b3)'), 'niacinamide'));
test('stripParenthetical no paren unchanged', () =>
  assert.strictEqual(_stripParenthetical('niacinamide'), 'niacinamide'));
test('isNoise +/-', () => assert.ok(_isNoise('+/-')));
test('isNoise may contain', () => assert.ok(_isNoise('may contain')));
test('isNoise water → false', () => assert.ok(!_isNoise('water')));

// ═══════════════════════════════════════════════════════════════════════════════
section('parseInciText — splits');
test('comma', () => assert.deepStrictEqual(parseInciText('AQUA, GLYCERIN'), ['AQUA', 'GLYCERIN']));
test('semicolon', () => assert.deepStrictEqual(parseInciText('AQUA; GLYCERIN'), ['AQUA', 'GLYCERIN']));
test('newline', () => {
  const r = parseInciText('AQUA\nGLYCERIN');
  assert.ok(r.includes('AQUA') && r.includes('GLYCERIN'));
});
test('whitespace trimmed', () =>
  assert.deepStrictEqual(parseInciText('  water ,  glycerin '), ['water', 'glycerin']));
test('empty/null → []', () => {
  assert.deepStrictEqual(parseInciText(''), []);
  assert.deepStrictEqual(parseInciText(null), []);
});
test('CI codes are kept', () => {
  const r = parseInciText('+/-, CI 77492, may contain');
  assert.ok(r.includes('CI 77492'));
});

// ═══════════════════════════════════════════════════════════════════════════════
section('resolveInciToken — noise');
test('+/- → noise, confidence=0', () => {
  const r = resolveInciToken('+/-', deps);
  assert.strictEqual(r.match_method, 'noise');
  assert.strictEqual(r.confidence, 0);
  assert.strictEqual(r.ingredient_canonical_id, null);
});
test('"may contain" → noise', () =>
  assert.strictEqual(resolveInciToken('may contain', deps).match_method, 'noise'));
test('"May Contain" mixed case → noise', () =>
  assert.strictEqual(resolveInciToken('May Contain', deps).match_method, 'noise'));

// ═══════════════════════════════════════════════════════════════════════════════
section('resolveInciToken — exact');
test('case-insensitive', () => {
  const r = resolveInciToken('WATER', deps);
  assert.strictEqual(r.match_method, 'exact');
  assert.strictEqual(r.ingredient_canonical_id, 'cosing:water');
  assert.strictEqual(r.confidence, 1);
});
test('confidence is number', () =>
  assert.strictEqual(typeof resolveInciToken('water', deps).confidence, 'number'));
test('internal whitespace normalised', () =>
  assert.strictEqual(resolveInciToken('hyaluronic  acid', deps).match_method, 'exact'));

section('resolveInciToken — parenthetical stripping');
test('"NIACINAMIDE (vitamin B3)" → exact', () => {
  const r = resolveInciToken('NIACINAMIDE (vitamin B3)', deps);
  assert.strictEqual(r.match_method, 'exact');
  assert.strictEqual(r.inci_name, 'niacinamide');
});
test('raw preserves original paren text', () => {
  const r = resolveInciToken('NIACINAMIDE (vitamin B3)', deps);
  assert.ok(r.raw.includes('('));
});

section('resolveInciToken — alias');
test('alias → cosing → method=alias, confidence=0.95', () => {
  const r = resolveInciToken('vitamin b3', deps);
  assert.strictEqual(r.match_method, 'alias');
  assert.strictEqual(r.ingredient_canonical_id, 'cosing:niacinamide');
  assert.strictEqual(r.confidence, 0.95);
});
test('alias case-insensitive', () =>
  assert.strictEqual(resolveInciToken('VITAMIN B3', deps).match_method, 'alias'));
test('alias → no cosing → alias_unverified, confidence=0.6', () => {
  const r = resolveInciToken('xyz-complex', depsWithUnverified);
  assert.strictEqual(r.match_method, 'alias_unverified');
  assert.strictEqual(r.confidence, 0.6);
  assert.ok(r.ingredient_canonical_id);
});

section('resolveInciToken — fuzzy');
test('single-char deletion → fuzzy', () => {
  const r = resolveInciToken('glcerin', deps);
  assert.strictEqual(r.match_method, 'fuzzy');
  assert.strictEqual(r.inci_name, 'glycerin');
  assert.ok(r.confidence < 0.95);
});
test('fuzzy dist=1 → confidence=0.75', () =>
  assert.strictEqual(resolveInciToken('glcerin', deps).confidence, 0.75));
test('fuzzy disabled when no candidates', () =>
  assert.strictEqual(resolveInciToken('glcerin', depsNoFuzzy).match_method, 'unresolved'));
test('too-short token (<5 chars) not fuzzy', () =>
  assert.notStrictEqual(resolveInciToken('wat', deps).match_method, 'fuzzy'));
test('too-distant typo → unresolved', () =>
  assert.strictEqual(resolveInciToken('glycerinXYZ', deps).match_method, 'unresolved'));

section('resolveInciToken — unresolved + robustness');
test('unknown → unresolved, null canonical', () => {
  const r = resolveInciToken('made-up-inci-string', depsNoFuzzy);
  assert.strictEqual(r.match_method, 'unresolved');
  assert.strictEqual(r.ingredient_canonical_id, null);
  assert.strictEqual(r.confidence, 0.35);
});
test('empty → empty', () =>
  assert.strictEqual(resolveInciToken('   ', deps).match_method, 'empty'));
test('null does not throw', () => assert.doesNotThrow(() => resolveInciToken(null, deps)));
test('null deps do not throw', () =>
  assert.doesNotThrow(() =>
    resolveInciToken('water', { getCosingIngredientByInci: null, getAliasCanonical: null })
  ));

// ═══════════════════════════════════════════════════════════════════════════════
section('resolveInciTextToRows — schema');
const REQUIRED_KEYS = [
  'inci_name',
  'ingredient_order',
  'raw_ingredient',
  'normalized_inci',
  'ingredient_role',
  'confidence',
  'ingredient_canonical_id',
  'match_method'
];
test('all required keys present', () => {
  const rows = resolveInciTextToRows('WATER, GLYCERIN', deps);
  for (const row of rows) {
    for (const k of REQUIRED_KEYS) {
      assert.ok(Object.prototype.hasOwnProperty.call(row, k), `missing: ${k}`);
    }
  }
});
test('ingredient_order sequential from 0', () => {
  const rows = resolveInciTextToRows('WATER, GLYCERIN, NIACINAMIDE', deps);
  rows.forEach((r, i) => assert.strictEqual(r.ingredient_order, i));
});
test('raw_ingredient preserves casing', () => {
  const rows = resolveInciTextToRows('WATER, Glycerin', deps);
  assert.strictEqual(rows[0].raw_ingredient, 'WATER');
  assert.strictEqual(rows[1].raw_ingredient, 'Glycerin');
});
test('confidence is number in rows', () => {
  const rows = resolveInciTextToRows('WATER, +/-, unknown', deps);
  for (const row of rows) {
    assert.strictEqual(typeof row.confidence, 'number', `${row.match_method}: ${typeof row.confidence}`);
  }
});
test('confidence in [0,1]', () => {
  const rows = resolveInciTextToRows('WATER, +/-, unknown', deps);
  for (const row of rows) {
    assert.ok(row.confidence >= 0 && row.confidence <= 1);
  }
});
test('ingredient_role null', () =>
  assert.strictEqual(resolveInciTextToRows('WATER', deps)[0].ingredient_role, null));
test('empty text → []', () => {
  assert.deepStrictEqual(resolveInciTextToRows('', deps), []);
  assert.deepStrictEqual(resolveInciTextToRows(null, deps), []);
});

section('resolveInciTextToRows — noise + mixed quality');
test('noise rows have method=noise, confidence=0, null id', () => {
  const rows = resolveInciTextToRows('+/-, CI 77492, may contain, WATER', deps);
  const noise = rows.filter((r) => r.match_method === 'noise');
  assert.strictEqual(noise.length, 2);
  for (const n of noise) {
    assert.strictEqual(n.confidence, 0);
    assert.strictEqual(n.ingredient_canonical_id, null);
  }
});
test('all five methods in one pass', () => {
  const rows = resolveInciTextToRows('water, vitamin b3, glcerin, unknownxyz, +/-', deps);
  const methods = rows.map((r) => r.match_method);
  for (const m of ['exact', 'alias', 'fuzzy', 'unresolved', 'noise']) {
    assert.ok(methods.includes(m), `missing method: ${m}`);
  }
});
test('high-coverage product ≥70% resolved', () => {
  const inci =
    'AQUA, GLYCERIN, NIACINAMIDE, HYALURONIC ACID, SALICYLIC ACID, ' +
    'ASCORBIC ACID, RETINOL, LACTIC ACID, UNKNOWN-A, UNKNOWN-B';
  const rows = resolveInciTextToRows(inci, deps);
  const resolved = rows.filter((r) => !['unresolved', 'noise'].includes(r.match_method));
  assert.ok(resolved.length / rows.length >= 0.7);
});

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
