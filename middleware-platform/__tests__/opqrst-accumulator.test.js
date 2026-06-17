'use strict';

const {
  mergeAccumulator,
  accumulatorFromTriageRow,
  applyFieldUtterance,
  filledCount
} = require('../services/conversation-mode/opqrst-accumulator');

describe('opqrst accumulator', () => {
  test('applyFieldUtterance writes both letter and key fields', () => {
    const acc = applyFieldUtterance({}, 'O', 'yesterday');
    expect(acc.O).toBe('yesterday');
    expect(acc.onset).toBe('yesterday');
  });

  test('accumulatorFromTriageRow maps triage row', () => {
    const acc = accumulatorFromTriageRow({
      onset: '2 days',
      quality: 'itchy',
      region: 'leg',
      severity: 5
    });
    expect(acc.O).toBe('2 days');
    expect(acc.Q).toBe('itchy');
    expect(filledCount(acc)).toBeGreaterThanOrEqual(3);
  });

  test('mergeAccumulator preserves rich_intake', () => {
    const acc = mergeAccumulator({ O: 'today' }, { rich_intake: { emergency_risk: false } });
    expect(acc.O).toBe('today');
    expect(acc.rich_intake).toEqual({ emergency_risk: false });
  });
});
