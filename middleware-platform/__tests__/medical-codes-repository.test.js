'use strict';

/**
 * Smoke tests for medical-codes repository via database facade.
 */

process.env.SKIP_STARTUP_MIGRATIONS = '1';

const db = require('../database');

describe('medical codes repository (database facade)', () => {
  test('searchIcd10Codes is exported and returns array', () => {
    expect(typeof db.searchIcd10Codes).toBe('function');
    const rows = db.searchIcd10Codes('hypertension', 5);
    expect(Array.isArray(rows)).toBe(true);
  });

  test('codeExists rejects unknown CPT', () => {
    expect(typeof db.codeExists).toBe('function');
    expect(db.codeExists('ZZZZNOTACODE', 'cpt')).toBe(false);
  });

  test('getCodeEmbeddingsCount is a non-negative number', () => {
    expect(typeof db.getCodeEmbeddingsCount).toBe('function');
    const n = db.getCodeEmbeddingsCount();
    expect(typeof n).toBe('number');
    expect(n).toBeGreaterThanOrEqual(0);
  });

  test('getCodeEmbeddingsBatch returns array without loading full table', () => {
    expect(typeof db.getCodeEmbeddingsBatch).toBe('function');
    const batch = db.getCodeEmbeddingsBatch('cpt', null, 0, 10);
    expect(Array.isArray(batch)).toBe(true);
    expect(batch.length).toBeLessThanOrEqual(10);
  });

  test('searchCptCodes and searchHcpcsCodes are exported', () => {
    expect(typeof db.searchCptCodes).toBe('function');
    expect(typeof db.searchHcpcsCodes).toBe('function');
    expect(Array.isArray(db.searchCptCodes('992', 3))).toBe(true);
    expect(Array.isArray(db.searchHcpcsCodes('G043', 3))).toBe(true);
  });
});
