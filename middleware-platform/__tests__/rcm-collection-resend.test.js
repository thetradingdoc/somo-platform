'use strict';

const crypto = require('crypto');

describe('RCM collection resend (recordAgentAction)', () => {
  it('recordAgentAction logs collection_outreach on journey', () => {
    const orchestrator = require('../services/rcm-journey-orchestrator');
    orchestrator.ensureKellyRcmTables();
    const db = require('../database');

    const clinicId = `clinic_resend_${crypto.randomBytes(4).toString('hex')}`;
    const patientId = `Patient/resend-${crypto.randomBytes(4).toString('hex')}`;
    const started = orchestrator.startJourney({
      clinicId,
      patientId,
      source: 'test_resend',
      stage: 'patient_collection',
      skipGates: true,
    });
    const journeyId = started.journey_id || started.journey?.id;

    orchestrator.recordAgentAction({
      journeyId,
      clinicId,
      stageTo: 'follow_up_phone',
      actionType: 'collection_outreach',
      payload: { payment_id: 'pay_test', amount: 25 },
    });

    const events = db.db
      .prepare(
        `SELECT event_type, stage_to FROM rcm_journey_events WHERE journey_id = ? ORDER BY created_at DESC`
      )
      .all(journeyId);
    expect(events.some((e) => e.event_type === 'collection_outreach')).toBe(true);
    expect(events.some((e) => e.stage_to === 'follow_up_phone')).toBe(true);
  });
});
