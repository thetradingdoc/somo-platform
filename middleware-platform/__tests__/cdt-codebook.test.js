'use strict';

/**
 * Phase 7.7 — CDT codebook import and resolveDentalCdtFromReason coverage.
 */

const path = require('path');
const fs = require('fs');

describe('CDT codebook (Phase 7.7)', () => {
  const dbPath = path.join(__dirname, '..', 'var/db/middleware-dev.db');

  beforeAll(() => {
    process.env.DB_PATH = dbPath;
    process.env.SKIP_STARTUP_MIGRATIONS = '0';
    jest.resetModules();
    const db = require('../database');
    const mig = require('../migrations/107_cdt_codes');
    mig.up(db.db);
    const cdtFile = path.join(__dirname, '..', '..', 'Knowledge/CDT/cdt-codes-2025.txt');
    if (fs.existsSync(cdtFile) && db.bulkUpsertCdtCodes) {
      const raw = fs.readFileSync(cdtFile, 'utf8');
      const codes = [];
      for (const line of raw.split(/\r?\n/)) {
        const m = line.trim().match(/^(D\d{4})\s+(.+)$/i);
        if (m) codes.push({ code: m[1], description: m[2], category: 'Dental', source_file: 'test' });
      }
      if (codes.length) db.bulkUpsertCdtCodes(codes);
    }
  });

  it('cdt_codes table has seed coverage', () => {
    const db = require('../database');
    const n = db.getCdtCodesCount?.() ?? 0;
    expect(n).toBeGreaterThan(100);
  });

  it('resolveDentalCdtFromReason resolves root canal via phrase map', () => {
    const { resolveDentalCdtFromReason } = require('../utils/cpt-helper');
    const r = resolveDentalCdtFromReason('I need a root canal on my molar');
    expect(r.code).toBe('D3310');
    expect(r.code_source).toBe('phrase_map');
  });

  it('resolveDentalCdtFromReason resolves crown via phrase map', () => {
    const { resolveDentalCdtFromReason } = require('../utils/cpt-helper');
    const r = resolveDentalCdtFromReason('I think I need a crown');
    expect(r.code).toBe('D2740');
  });

  it('resolveDentalCdtFromReason resolves extraction', () => {
    const { resolveDentalCdtFromReason } = require('../utils/cpt-helper');
    const r = resolveDentalCdtFromReason('tooth extraction please');
    expect(r.code).toBe('D7140');
  });

  it('resolveDentalCdtFromReason resolves periodontal scaling', () => {
    const { resolveDentalCdtFromReason } = require('../utils/cpt-helper');
    const r = resolveDentalCdtFromReason('I need deep cleaning periodontal scaling');
    expect(r.code).toBe('D4341');
  });

  it('resolveAdminVisitCodes does not return CODE_NOT_IN_STARTER_SET for root canal', () => {
    const { resolveAdminVisitCodes } = require('../services/resolve-admin-visit-codes');
    const r = resolveAdminVisitCodes('root canal on back tooth', 'Dental');
    expect(r.ok).toBe(true);
    expect(r.primary_cpt).toBe('D3310');
    expect(r.error_code).toBeUndefined();
  });
});
