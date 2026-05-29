'use strict';

const orchestrator = require('../../services/rcm-journey-orchestrator');

describe('rcm-journey-orchestrator gates', () => {
  beforeAll(() => {
    orchestrator.ensureKellyRcmTables();
  });

  test('registration gate requires eligibility unless skipped', () => {
    const journey = { patient_id: 'pat_test', stage: 'pre_registration' };
    const blocked = orchestrator.validateStageAdvance(journey, 'registration', {});
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe('gate_eligibility_required');

    const allowed = orchestrator.validateStageAdvance(journey, 'registration', {
      allowNoEligibility: true,
    });
    expect(allowed.ok).toBe(true);
  });

  test('startJourney uses pre_registration stage', () => {
    const { journey, created } = orchestrator.startJourney({
      clinicId: 'clinic-e2e-test',
      source: 'jest',
      skipGates: true,
    });
    expect(created).toBe(true);
    expect(journey.stage).toBe('pre_registration');
  });
});
