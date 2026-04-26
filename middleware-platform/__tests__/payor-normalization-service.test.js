const {
  normalizePayorName,
  soundex
} = require('../services/payor-normalization-service');

describe('payor normalization service', () => {
  const dict = {
    abbreviationMap: new Map([
      ['uhc', 'unitedhealthcare'],
      ['bcbs', 'blue cross blue shield'],
      ['hcsc', 'health care service corporation']
    ]),
    stopwords: new Set(['insurance', 'company', 'inc', 'llc', 'of', 'the', 'and', 'care', 'service', 'corporation'])
  };

  test('applies deterministic lowercase/strip punctuation/abbreviation/stopword pipeline', () => {
    const out = normalizePayorName('UHC - Insurance Company, Inc.', dict);
    expect(out.normalized_name).toBe('unitedhealthcare');
    expect(out.normalized_tokens).toEqual(['unitedhealthcare']);
    expect(out.canonical_tokens).toEqual(['unitedhealthcare']);
  });

  test('extracts state suffix from phrase form', () => {
    const out = normalizePayorName('Blue Cross Blue Shield of Ohio', dict);
    expect(out.stripped_state).toBe('OH');
    expect(out.normalized_name).toBe('blue cross blue shield');
  });

  test('handles state code suffix and generates blocking keys', () => {
    const out = normalizePayorName('United Healthcare TX', dict);
    expect(out.stripped_state).toBe('TX');
    expect(out.soundex_key).toBe(soundex('united'));
    expect(out.prefix_key).toBe('unit_heal');
  });

  test('same input always yields same normalized output', () => {
    const a = normalizePayorName('HCSC of Illinois', dict);
    const b = normalizePayorName('HCSC of Illinois', dict);
    expect(a).toEqual(b);
  });

  test('captures stable input/output normalization snapshot', () => {
    const out = normalizePayorName('UHC Choice Plus of Ohio, Inc.', dict);
    expect(out).toMatchInlineSnapshot(`
      {
        "canonical_tokens": [
          "choice",
          "plus",
          "unitedhealthcare",
        ],
        "normalized_name": "unitedhealthcare choice plus",
        "normalized_tokens": [
          "unitedhealthcare",
          "choice",
          "plus",
        ],
        "prefix_key": "unit_choi_plus",
        "soundex_key": "U533",
        "stripped_state": "OH",
      }
    `);
  });
});

