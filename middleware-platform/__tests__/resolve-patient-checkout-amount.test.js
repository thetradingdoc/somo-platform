'use strict';

const { resolvePatientCheckoutAmount } = require('../services/resolve-amount-due');

describe('resolvePatientCheckoutAmount', () => {
  test('uses voice checkout amount when present', async () => {
    const r = await resolvePatientCheckoutAmount({
      voiceCheckoutAmount: 42.5,
      clinicId: 'clinic-default',
      appointmentType: 'Dental Cleaning'
    });
    expect(r.ok).toBe(true);
    expect(r.amount).toBe(42.5);
  });

  test('blocks thin eligibility from visit_pricing fallback', async () => {
    const db = require('../database');
    if (!db.db) return;

    const patientId = `pat_thin_${Date.now()}`;
    const eligId = `elig_thin_${Date.now()}`;
    db.db.prepare(`
      INSERT OR IGNORE INTO fhir_patients (resource_id, resource_data, phone, name, is_deleted)
      VALUES (?, ?, ?, 'Thin Test', 0)
    `).run(
      patientId,
      JSON.stringify({ resourceType: 'Patient', id: patientId }),
      `+1555${String(Date.now()).slice(-7)}`
    );
    db.db.prepare(`
      INSERT INTO eligibility_checks (
        id, patient_id, member_id, payer_id, service_code, copay_amount, eligible,
        eligibility_quality, created_at
      ) VALUES (?, ?, 'MBR', 'DELTA', 'D1110', NULL, 1, 'thin', datetime('now'))
    `).run(eligId, patientId);

    const r = await resolvePatientCheckoutAmount({
      patientId,
      clinicId: 'clinic-default',
      appointmentType: 'Dental Cleaning'
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('amount_pending_verification');
  });
});
