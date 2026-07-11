'use strict';

const Database = require('better-sqlite3');
const { buildNcciPairRows, NCCI_SAMPLE_PAIRS, countEmProcedurePairs } = require('../scripts/lib/ncci-pairs-sample.cjs');

describe('NCCI pairs expanded import (BL-01)', () => {
  let sqlite;
  let repo;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    require('../migrations/109_pair_rules').up(sqlite);
    repo = require('../database/repositories/medical-codes').createMedicalCodesRepository(sqlite);
  });

  afterEach(() => {
    sqlite?.close();
  });

  test('sample set exceeds 32 rules', () => {
    expect(NCCI_SAMPLE_PAIRS.length).toBeGreaterThan(32);
    expect(buildNcciPairRows().length).toBeGreaterThan(32);
  });

  test('includes common E/M + procedure combos', () => {
    expect(countEmProcedurePairs()).toBeGreaterThan(20);
    const pairs = new Set(
      NCCI_SAMPLE_PAIRS.map((p) => `${p.column1_code}+${p.column2_code}`)
    );
    expect(pairs.has('99213+36415')).toBe(true);
    expect(pairs.has('99214+11102')).toBe(true);
    expect(pairs.has('99213+93000')).toBe(true);
    expect(pairs.has('99214+20610')).toBe(true);
  });

  test('bulkUpsertPairRules loads pair_rules table', () => {
    const rows = buildNcciPairRows();
    const result = repo.bulkUpsertPairRules(rows);
    expect(result.inserted).toBe(rows.length);
    expect(repo.getPairRulesCount()).toBeGreaterThan(32);

    const sample = sqlite.prepare(
      'SELECT column1_code, column2_code, modifier_indicator FROM pair_rules WHERE column1_code = ? AND column2_code = ?'
    ).get('99214', '36415');
    expect(sample).toMatchObject({ column1_code: '99214', column2_code: '36415', modifier_indicator: 1 });
  });

  test('deduplicates identical column1/column2 pairs', () => {
    const dupRows = buildNcciPairRows([
      ...NCCI_SAMPLE_PAIRS,
      { column1_code: '99213', column2_code: '36415', modifier_indicator: 1, reason: 'dup' }
    ]);
    expect(dupRows.length).toBe(buildNcciPairRows().length);
  });
});
