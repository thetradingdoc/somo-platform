'use strict';

const db = require('../../database');
const orchestrator = require('../../services/rcm-journey-orchestrator');
const settlement = require('../../services/rcm-payment-settlement');

describe('rcm payment settlement', () => {
  beforeAll(() => {
    orchestrator.ensureKellyRcmTables();
  });

  test('markPaidProvider advances journey to bill', () => {
    const clinicId = 'clinic-pay-test';
    const { journey } = orchestrator.startJourney({
      clinicId,
      skipGates: true,
      stage: 'patient_collection',
    });
    const payToken = `tok_${Date.now()}`;
    const payId = `pay_${Date.now()}`;
    db.db
      .prepare(
        `INSERT INTO rcm_payments (id, clinic_id, journey_id, amount, status, pay_token) VALUES (?, ?, ?, ?, 'requested', ?)`
      )
      .run(payId, clinicId, journey.id, 10, payToken);

    const row = db.db.prepare(`SELECT * FROM rcm_payments WHERE id = ?`).get(payId);
    const result = settlement.markPaidProvider(row, { method: 'manual' });
    expect(result.success).toBe(true);
    expect(result.status).toBe('paid');

    const updated = orchestrator.getJourney(clinicId, journey.id);
    expect(updated.stage).toBe('bill');
  });
});
