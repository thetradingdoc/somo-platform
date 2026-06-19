'use strict';

const KellyToolExecutor = require('../services/kelly-tool-executor');

jest.mock('../database', () => ({
  upsertTriageSession: jest.fn(() => 'triage-1'),
  getTriageSession: jest.fn(() => ({})),
  getKellySessionLanguage: jest.fn(() => null)
}));

describe('store_triage_opqrst site gate (SITE-22)', () => {
  test('blocks when site_context_status is missing', async () => {
    const out = await KellyToolExecutor.execute(
      'store_triage_opqrst',
      { onset: 'today', quality: 'sharp pain' },
      {
        sessionId: 'sess-1',
        clinicId: 'clinic-1',
        site_context_status: 'missing',
        channel: 'voice'
      }
    );
    expect(out.success).toBe(false);
    expect(out.error).toBe('site_context_unverified');
  });

  test('allows when site_context_status is verified', async () => {
    const out = await KellyToolExecutor.execute(
      'store_triage_opqrst',
      { onset: 'today', quality: 'sharp pain', severity: 5, timing: 'constant' },
      {
        sessionId: 'sess-2',
        clinicId: 'clinic-1',
        site_context_status: 'verified',
        channel: 'voice'
      }
    );
    expect(out.success).not.toBe(false);
  });
});
