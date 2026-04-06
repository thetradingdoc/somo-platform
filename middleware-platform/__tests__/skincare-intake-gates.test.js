'use strict';

const KellyToolExecutor = require('../services/kelly-tool-executor');

describe('Skin & Care hard gates', () => {
  test('all five satisfied with concerns array + prior seen false', () => {
    const row = {
      skin_type: 'dry',
      skin_concerns_json: ['acne'],
      pregnancy_status: 'not_pregnant_not_bf',
      prior_dermatologist_json: { seen: false, note: '' },
      functional_impact: 3
    };
    expect(KellyToolExecutor._skincareHardGateMissingList(row)).toEqual([]);
  });

  test('quality text counts as concern when skin_concerns_json empty', () => {
    const row = {
      skin_type: 'oily',
      quality: 'breakouts on jawline',
      pregnancy_status: 'unknown',
      prior_dermatologist_json: { seen: true, note: 'derm last year' },
      functional_impact: 2
    };
    expect(KellyToolExecutor._skincareHardGateMissingList(row)).toEqual([]);
  });

  test('missing prior_dermatologist seen', () => {
    const row = {
      skin_type: 'dry',
      skin_concerns_json: ['x'],
      pregnancy_status: 'not_pregnant_not_bf',
      prior_dermatologist_json: { seen: null, note: '' },
      functional_impact: 1
    };
    expect(KellyToolExecutor._skincareHardGateMissingList(row)).toContain('prior_dermatologist');
  });

  test('functional_impact out of range', () => {
    const row = {
      skin_type: 'dry',
      skin_concerns_json: ['x'],
      pregnancy_status: 'not_pregnant_not_bf',
      prior_dermatologist_json: { seen: false },
      functional_impact: 9
    };
    expect(KellyToolExecutor._skincareHardGateMissingList(row)).toContain('functional_impact');
  });
});
