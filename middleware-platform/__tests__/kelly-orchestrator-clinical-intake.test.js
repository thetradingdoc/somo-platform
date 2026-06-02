'use strict';

const KellyOrchestratorPhase = require('../services/kelly-orchestrator-phase');

describe('clinicClinicalMinimumIntakeMet (I2-7)', () => {
  test('OBGYN path without skin type still meets minimum', () => {
    const sessionRow = {
      quality: 'pelvic pain',
      region: 'pelvis',
      severity: 4,
      onset: '2 weeks',
      target_specialty: 'Obstetrics and Gynecology'
    };
    const metaGet = () => null;
    expect(KellyOrchestratorPhase.clinicClinicalMinimumIntakeMet({ sessionRow, metaGet })).toBe(true);
    expect(KellyOrchestratorPhase.clinicMinimumIntakeMet({ sessionRow, metaGet })).toBe(true);
  });

  test('derm still requires skin for clinicDermMinimumIntakeMet', () => {
    const sessionRow = {
      quality: 'rash',
      region: 'arm',
      severity: 3,
      onset: '1 week',
      target_specialty: 'Dermatology'
    };
    expect(
      KellyOrchestratorPhase.clinicDermMinimumIntakeMet({ sessionRow, metaGet: () => null })
    ).toBe(false);
  });
});
