'use strict';

const {
  normalizeZip,
  normalizeCountyName
} = require('../services/geo-normalize');

// normalizeZip contract: replace(/[^\d]/g, '').slice(0, 5)
describe('normalizeZip', () => {
  describe('standard 5-digit ZIPs', () => {
    test('clean 5-digit ZIP passes through unchanged', () => {
      expect(normalizeZip('07205')).toBe('07205');
      expect(normalizeZip('10456')).toBe('10456');
      expect(normalizeZip('90210')).toBe('90210');
      expect(normalizeZip('33101')).toBe('33101');
      expect(normalizeZip('60601')).toBe('60601');
    });

    test('leading zeros preserved', () => {
      expect(normalizeZip('01234')).toBe('01234');
      expect(normalizeZip('00501')).toBe('00501');
    });
  });

  describe('ZIP+4 format stripping', () => {
    test('strips dash and 4-digit suffix', () => {
      expect(normalizeZip('07205-1234')).toBe('07205');
      expect(normalizeZip('10456-9999')).toBe('10456');
      expect(normalizeZip('90210-0000')).toBe('90210');
    });
  });

  describe('whitespace handling', () => {
    test('strips surrounding spaces', () => {
      expect(normalizeZip(' 07205 ')).toBe('07205');
      expect(normalizeZip('  10456  ')).toBe('10456');
    });
    test('strips internal spaces (non-digit removal)', () => {
      expect(normalizeZip('072 05')).toBe('07205');
    });
  });

  describe('non-digit prefix/suffix characters', () => {
    test('strips non-digit prefix', () => {
      expect(normalizeZip('abc07205')).toBe('07205');
      expect(normalizeZip('ZIP:10456')).toBe('10456');
    });
    test('interleaved non-digits are stripped before slicing', () => {
      expect(normalizeZip('x1y2z3o4z5')).toBe('12345');
    });
    test('non-digit between digits removed uniformly', () => {
      expect(normalizeZip('1-2-3-4-5')).toBe('12345');
    });
  });

  describe('short inputs', () => {
    test('short ZIP (less than 5 digits) returns what is there', () => {
      expect(normalizeZip('72')).toBe('72');
      expect(normalizeZip('1')).toBe('1');
    });
    test('empty string returns empty string', () => {
      expect(normalizeZip('')).toBe('');
    });
  });

  describe('null / undefined safety', () => {
    test('null returns empty string', () => {
      expect(normalizeZip(null)).toBe('');
    });
    test('undefined returns empty string', () => {
      expect(normalizeZip(undefined)).toBe('');
    });
  });

  describe('longer-than-5 digit strings', () => {
    test('truncates to first 5 digits after stripping', () => {
      expect(normalizeZip('123456789')).toBe('12345');
      expect(normalizeZip('072051234')).toBe('07205');
    });
  });
});

describe('normalizeCountyName', () => {
  describe('standard "County" suffix stripping', () => {
    test('strips " County" suffix (title case)', () => {
      expect(normalizeCountyName('Union County')).toBe('union');
      expect(normalizeCountyName('Essex County')).toBe('essex');
      expect(normalizeCountyName('Miami-Dade County')).toBe('miami-dade');
      expect(normalizeCountyName('Los Angeles County')).toBe('los angeles');
      expect(normalizeCountyName('San Francisco County')).toBe('san francisco');
    });
    test('strips " county" suffix (lowercase)', () => {
      expect(normalizeCountyName('union county')).toBe('union');
    });
    test('strips " COUNTY" suffix (uppercase)', () => {
      expect(normalizeCountyName('UNION COUNTY')).toBe('union');
    });
  });

  describe('bare county names (no suffix)', () => {
    test('bare name lowercased and trimmed', () => {
      expect(normalizeCountyName('Union')).toBe('union');
      expect(normalizeCountyName('Essex')).toBe('essex');
    });
  });

  describe('whitespace and punctuation', () => {
    test('trims surrounding whitespace and trailing period', () => {
      expect(normalizeCountyName('  union county. ')).toBe('union');
      expect(normalizeCountyName('  Essex  ')).toBe('essex');
    });
  });

  describe('St. / Saint county variants', () => {
    test('St. prefix normalizes (period stripped)', () => {
      expect(normalizeCountyName('St. Louis County')).toBe('st louis');
      expect(normalizeCountyName('St Louis County')).toBe('st louis');
    });
    test('Saint prefix (spelled out) — different token than St.; callers may need aliases', () => {
      const result = normalizeCountyName('Saint Louis County');
      expect(typeof result).toBe('string');
      expect(result).not.toContain('county');
      expect(result.length).toBeGreaterThan(0);
      expect(result).toBe('saint louis');
    });
  });

  describe('multi-word counties', () => {
    test('New York County', () => {
      expect(normalizeCountyName('New York County')).toBe('new york');
    });
    test('Prince George\'s County', () => {
      const result = normalizeCountyName("Prince George's County");
      expect(result).not.toContain('county');
      expect(result.toLowerCase()).toContain('prince george');
    });
    test('Cook County', () => {
      expect(normalizeCountyName('Cook County')).toBe('cook');
    });
    test('Harris County', () => {
      expect(normalizeCountyName('Harris County')).toBe('harris');
    });
    test('Maricopa County', () => {
      expect(normalizeCountyName('Maricopa County')).toBe('maricopa');
    });
  });

  describe('hyphenated county names', () => {
    test('Miami-Dade County', () => {
      expect(normalizeCountyName('Miami-Dade County')).toBe('miami-dade');
    });
    test('Fond du Lac County (WI)', () => {
      const result = normalizeCountyName('Fond du Lac County');
      expect(result).not.toContain('county');
      expect(result).toBe('fond du lac');
    });
  });

  describe('edge cases: null / undefined / empty', () => {
    test('null returns empty string', () => {
      expect(normalizeCountyName(null)).toBe('');
    });
    test('undefined returns empty string', () => {
      expect(normalizeCountyName(undefined)).toBe('');
    });
    test('empty string returns empty string', () => {
      expect(normalizeCountyName('')).toBe('');
    });
    test('whitespace-only string returns empty string', () => {
      expect(normalizeCountyName('   ')).toBe('');
    });
  });

  describe('real CMS county names from service area file', () => {
    const CMS_SAMPLES = [
      ['Broward County', 'broward'],
      ['Palm Beach County', 'palm beach'],
      ['Hillsborough County', 'hillsborough'],
      ['Orange County', 'orange'],
      ['Riverside County', 'riverside'],
      ['San Diego County', 'san diego'],
      ['King County', 'king'],
      ['Allegheny County', 'allegheny'],
      ['Wayne County', 'wayne'],
      ['Cuyahoga County', 'cuyahoga'],
      ['Tarrant County', 'tarrant'],
      ['Bexar County', 'bexar'],
      ['Travis County', 'travis']
    ];
    test.each(CMS_SAMPLES)('normalizes "%s" → "%s"', (input, expected) => {
      expect(normalizeCountyName(input)).toBe(expected);
    });
  });
});
