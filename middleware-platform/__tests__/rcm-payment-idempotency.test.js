'use strict';

const crypto = require('crypto');

describe('RCM payment + journey idempotency (G1)', () => {
  it('journey appendEvent dedupeKey prevents duplicate stage events', () => {
    const orchestrator = require('../services/rcm-journey-orchestrator');
    orchestrator.ensureKellyRcmTables();

    const clinicId = `clinic_g1_${crypto.randomBytes(4).toString('hex')}`;
    const patientId = `Patient/g1-${crypto.randomBytes(4).toString('hex')}`;
    const started = orchestrator.startJourney({
      clinicId,
      patientId,
      source: 'test_g1',
      stage: 'registration',
      skipGates: true,
    });
    const journeyId = started.journey_id || started.journey?.id;
    expect(journeyId).toBeTruthy();

    const dedupeKey = `test_event:patient_collection:${journeyId}`;
    orchestrator.appendEvent({
      journeyId,
      clinicId,
      eventType: 'payment_link_sent',
      stageTo: 'patient_collection',
      payload: { amount: 25 },
      dedupeKey,
    });
    orchestrator.appendEvent({
      journeyId,
      clinicId,
      eventType: 'payment_link_sent',
      stageTo: 'patient_collection',
      payload: { amount: 25 },
      dedupeKey,
    });

    const db = require('../database');
    const count = db.db
      .prepare(
        `SELECT COUNT(*) AS c FROM rcm_journey_events WHERE journey_id = ? AND event_type = 'payment_link_sent'`
      )
      .get(journeyId).c;
    expect(count).toBe(1);
  });
});
