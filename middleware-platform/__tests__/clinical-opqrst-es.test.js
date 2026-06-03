'use strict';

const { loadPack, getNextQuestion } = require('../services/clinical-opqrst-registry');

describe('clinical-opqrst registry', () => {
  test('en pack loads core questions', () => {
    const pack = loadPack('en');
    expect(pack?.questions?.opqrst_onset?.text).toMatch(/When did/i);
    const q = getNextQuestion('en', 'opqrst_onset', 'dermatology');
    expect(q?.text).toBeTruthy();
  });

  test('es pack blocked without sign-off', () => {
    const prevPack = process.env.KELLY_OPQRST_ES_PACK;
    delete process.env.KELLY_OPQRST_ES_PACK;
    expect(getNextQuestion('es', 'opqrst_onset', 'dermatology')).toBeNull();
    if (prevPack) process.env.KELLY_OPQRST_ES_PACK = prevPack;
  });
});
