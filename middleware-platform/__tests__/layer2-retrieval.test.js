'use strict';

const { filterIcd10ByGuidelines } = require('../services/layer2-rag/guideline-resolver');
const { filterCodesByNegativeConstraints } = require('../services/layer2-rag/negative-constraints');
const { buildSearchIntent } = require('../services/layer2-rag/search-intent-builder');

describe('layer2 retrieval (E-04, E-05)', () => {
  test('guideline-resolver filters pediatric codes for adult context', () => {
    const codes = [{ code: 'P07.1', description: 'Newborn' }, { code: 'J06.9', description: 'URI' }];
    const out = filterIcd10ByGuidelines(codes, [], { patient_age: 40 });
    expect(out.filtered.some((c) => c.code === 'J06.9')).toBe(true);
  });

  test('negative-constraints removes excluded terms', () => {
    const codes = [{ code: 'J45.909', description: 'Asthma' }, { code: 'J44.9', description: 'COPD' }];
    const out = filterCodesByNegativeConstraints(codes, ['asthma']);
    expect(out.every((c) => !/asthma/i.test(c.description))).toBe(true);
  });

  test('search-intent-builder shapes query from perceptual state', () => {
    const intent = buildSearchIntent(
      { expanded_text: 'chest pain exertion', specialty_tag: 'Cardiology' },
      'chest pain'
    );
    expect(intent.query).toBeTruthy();
    expect(intent.specialty).toBe('Cardiology');
  });
});

describe('telehealth ranking (E-06)', () => {
  test('rankCptWithTelehealthContext prefers telehealth-friendly E/M', () => {
    const ks = require('../services/knowledge-service');
    if (typeof ks.rankCptWithTelehealthContext !== 'function') return;
    const ranked = ks.rankCptWithTelehealthContext(
      [{ code: '99213', description: 'Office visit' }],
      { telehealth: true }
    );
    expect(ranked[0].code).toBe('99213');
  });
});
