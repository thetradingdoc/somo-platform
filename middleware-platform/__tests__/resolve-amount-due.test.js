'use strict';

const crypto = require('crypto');
const { resolveAmountDue } = require('../services/resolve-amount-due');

describe('resolve-amount-due', () => {
  test('exports resolveAmountDue function', () => {
    expect(typeof resolveAmountDue).toBe('function');
  });

  test('returns cannot_determine without patient or session', async () => {
    const r = await resolveAmountDue({});
    expect(r.status).toBe('cannot_determine');
  });

  test('3.1 hard copay from seeded eligibility_checks row', async () => {
    const db = require('../database');
    if (!db.db) return;
    const patientId = `pat_resolve_${crypto.randomBytes(4).toString('hex')}`;
    db.db.prepare(
      `INSERT OR IGNORE INTO fhir_patients (resource_id, resource_data, phone, name, is_deleted)
       VALUES (?, ?, ?, 'Resolve E2E', 0)`
    ).run(
      patientId,
      JSON.stringify({ resourceType: 'Patient', id: patientId, name: [{ family: 'Resolve', given: ['E2E'] }] }),
      '+15550001111'
    );
    const eligId = `elig_resolve_${crypto.randomBytes(4).toString('hex')}`;
    db.db
      .prepare(
        `INSERT INTO eligibility_checks (
          id, patient_id, member_id, payer_id, service_code, copay_amount, eligible,
          eligibility_quality, created_at
        ) VALUES (?, ?, ?, ?, 'D1110', ?, 1, 'hard_copay', datetime('now'))`
      )
      .run(eligId, patientId, 'MBR_RESOLVE', 'DELTA_DENTAL_NY', 35);

    const r = await resolveAmountDue({ patientId, serviceCode: 'D1110' });
    expect(r.status).toBe('hard_number');
    expect(r.amount).toBe(35);
  });

  test('3.2 thin 271 returns thin status', async () => {
    const db = require('../database');
    if (!db.db) return;
    const patientId = `pat_thin_${crypto.randomBytes(4).toString('hex')}`;
    db.db.prepare(
      `INSERT OR IGNORE INTO fhir_patients (resource_id, resource_data, phone, name, is_deleted)
       VALUES (?, ?, ?, 'Thin E2E', 0)`
    ).run(
      patientId,
      JSON.stringify({ resourceType: 'Patient', id: patientId, name: [{ family: 'Thin', given: ['E2E'] }] }),
      '+15550002222'
    );
    const eligId = `elig_thin_${crypto.randomBytes(4).toString('hex')}`;
    db.db
      .prepare(
        `INSERT INTO eligibility_checks (
          id, patient_id, member_id, payer_id, service_code, copay_amount, eligible,
          eligibility_quality, created_at
        ) VALUES (?, ?, ?, ?, 'D1110', NULL, 1, 'thin', datetime('now'))`
      )
      .run(eligId, patientId, 'MBR_THIN', 'DELTA_DENTAL_NY');

    const r = await resolveAmountDue({ patientId, serviceCode: 'D1110' });
    expect(r.status).toBe('thin');
  });
});
