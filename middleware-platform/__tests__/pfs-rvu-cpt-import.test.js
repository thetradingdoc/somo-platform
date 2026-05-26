'use strict';

const path = require('path');
const { parsePfsRvuFile, normalizePfsCode } = require('../lib/pfs-rvu-parse');

const PPRRVU = path.resolve(__dirname, '../../Knowledge/fee-schedules/PPRRVU.csv');

describe('pfs-rvu-parse', () => {
  test('normalizePfsCode accepts 5-digit E/M codes', () => {
    expect(normalizePfsCode('99213')).toBe('99213');
    expect(normalizePfsCode('90834')).toBe('90834');
    expect(normalizePfsCode('abc')).toBeNull();
  });

  test('parsePfsRvuFile extracts 99213 and skips modifier rows', () => {
    if (!require('fs').existsSync(PPRRVU)) {
      console.warn('Skipping: PPRRVU.csv not present');
      return;
    }
    const { codes, stats } = parsePfsRvuFile(PPRRVU);
    expect(stats.parsed).toBeGreaterThan(5000);
    const byCode = new Map(codes.map((c) => [c.code, c]));
    expect(byCode.has('99213')).toBe(true);
    expect(byCode.get('99213').description.toLowerCase()).toMatch(/office/);
    expect(byCode.has('90834')).toBe(true);
    expect(stats.skipped_modifier_rows).toBeGreaterThan(0);
    const withMod = codes.filter((c) => c.code === '99213' && c.description.includes('mod'));
    expect(withMod.length).toBeLessThanOrEqual(1);
  });
});
