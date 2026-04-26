const { computeDecision, DEFAULT_POLICY } = require('../services/payor-resolution-scoring-service');

describe('payor resolution scoring service', () => {
  test('auto-merge when hard identifiers align', () => {
    const out = computeDecision({
      left_raw_npi: '123',
      right_raw_npi: '123',
      left_raw_payer_id: 'P1',
      right_raw_payer_id: 'P1',
      jaro_winkler: 1.0,
      token_sort_ratio: 1.0,
      token_set_ratio: 1.0,
      left_state: 'OH',
      right_state: 'OH'
    }, DEFAULT_POLICY);
    expect(out.decision).toBe('auto_merge');
    expect(out.final_score).toBeGreaterThanOrEqual(0.9);
  });

  test('merge+review flag in 0.70-0.89 range', () => {
    const out = computeDecision({
      left_raw_npi: 'NPI1',
      right_raw_npi: 'NPI1',
      left_raw_payer_id: 'P2',
      right_raw_payer_id: 'P2',
      jaro_winkler: 0.2,
      token_sort_ratio: 0.2,
      token_set_ratio: 0.2,
      left_state: 'OH',
      right_state: 'OH'
    }, DEFAULT_POLICY);
    expect(out.final_score).toBeGreaterThanOrEqual(0.7);
    expect(out.final_score).toBeLessThan(0.9);
    expect(out.decision).toBe('merge_review_flag');
  });

  test('distinct below 0.40', () => {
    const out = computeDecision({
      left_raw_npi: '',
      right_raw_npi: '',
      left_raw_payer_id: '',
      right_raw_payer_id: '',
      jaro_winkler: 0.2,
      token_sort_ratio: 0.15,
      token_set_ratio: 0.1,
      left_state: 'OH',
      right_state: 'TX'
    }, DEFAULT_POLICY);
    expect(out.final_score).toBeLessThan(0.4);
    expect(out.decision).toBe('distinct');
  });
});

