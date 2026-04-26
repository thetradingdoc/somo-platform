const {
  jaroWinkler,
  tokenSortRatio,
  tokenSetRatio,
  scoreNamePair
} = require('../services/payor-fuzzy-match-service');

describe('payor fuzzy match service', () => {
  test('jaro-winkler handles typo/spacing similarity', () => {
    const a = jaroWinkler('unitedhealthcare', 'unitted healthcare');
    expect(a).toBeGreaterThan(0.85);
  });

  test('token sort ratio handles word-order swaps', () => {
    const s = tokenSortRatio('blue cross blue shield', 'blue shield blue cross');
    expect(s).toBeGreaterThan(0.95);
  });

  test('token set ratio handles subset/subsidiary relation', () => {
    const s = tokenSetRatio('aetna', 'aetna better health of virginia');
    expect(s).toBeGreaterThan(0.5);
  });

  test('scoreNamePair returns all three metrics', () => {
    const out = scoreNamePair('cigna behavioral health', 'cigna health behavioral');
    expect(out).toHaveProperty('jaro_winkler');
    expect(out).toHaveProperty('token_sort_ratio');
    expect(out).toHaveProperty('token_set_ratio');
  });
});

