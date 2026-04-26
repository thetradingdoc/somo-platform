const { resolvePayerSearchResult } = require('../services/payor-resolution-utils');

describe('payor resolution utils', () => {
  test('returns single payer_id for one match', () => {
    const out = resolvePayerSearchResult({
      success: true,
      payers: [{ payer_id: '87726', payer_name: 'UnitedHealthcare Insurance Company' }]
    });
    expect(out.status).toBe('single');
    expect(out.payer_id).toBe('87726');
  });

  test('returns ambiguous for multiple matches', () => {
    const out = resolvePayerSearchResult({
      success: true,
      payers: [
        { payer_id: '87726', payer_name: 'UnitedHealthcare Insurance Company' },
        { payer_id: 'OH-UHC', payer_name: 'United Healthcare of Ohio' }
      ]
    });
    expect(out.status).toBe('ambiguous');
    expect(out.suggestions).toHaveLength(2);
  });

  test('returns none for empty matches', () => {
    const out = resolvePayerSearchResult({
      success: true,
      payers: []
    });
    expect(out.status).toBe('none');
    expect(out.suggestions).toEqual([]);
  });

  test('returns error when single match lacks payer_id', () => {
    const out = resolvePayerSearchResult({
      success: true,
      payers: [{ payer_name: 'Unknown Payer' }]
    });
    expect(out.status).toBe('error');
  });
});

