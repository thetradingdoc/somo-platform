'use strict';

const crypto = require('crypto');

describe('RCM patient context (journey + PA flags)', () => {
  it('findOpenJourneyForPatient returns open journey', () => {
    const orchestrator = require('../services/rcm-journey-orchestrator');
    orchestrator.ensureKellyRcmTables();

    const clinicId = `clinic_ctx_${crypto.randomBytes(4).toString('hex')}`;
    const patientId = `Patient/ctx-${crypto.randomBytes(4).toString('hex')}`;
    const started = orchestrator.startJourney({
      clinicId,
      patientId,
      source: 'test_ctx',
      stage: 'patient_collection',
      skipGates: true,
    });
    const journeyId = started.journey_id || started.journey?.id;
    expect(journeyId).toBeTruthy();

    const row = orchestrator.findOpenJourneyForPatient(clinicId, patientId);
    expect(row).toBeTruthy();
    expect(row.id).toBe(journeyId);

    const enriched = orchestrator.enrichJourney(row);
    expect(enriched.stage).toBe('patient_collection');
    expect(enriched.stage_contract?.label).toBeTruthy();
  });
});
