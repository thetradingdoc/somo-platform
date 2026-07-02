'use strict';

const path = require('path');
const fs = require('fs');

describe('phase3-phi-isolation', () => {
  let database;
  let PmsHub;

  beforeAll(() => {
    const tmp = path.join(__dirname, '..', 'tmp-test-phase3-phi.db');
    try {
      fs.unlinkSync(tmp);
    } catch (_) {}
    process.env.DB_PATH = tmp;
    jest.resetModules();
    database = require('../database');
    PmsHub = require('../services/pms/pms-hub').PmsHub;
    const db = database.db;

    db.exec(`
      INSERT OR REPLACE INTO clinics (clinic_id, name, slug, pms_type, pms_enabled, office_type)
      VALUES ('clinic-a', 'A Dental', 'clinic-a', 'somo', 1, 'dental'),
             ('clinic-b', 'B Dental', 'clinic-b', 'somo', 1, 'dental');
    `);
    require('../migrations/070_fhir_patients_clinic_id').up(db);
    require('../migrations/102_phase3_data_orchestration').up(db);

    const payload = JSON.stringify({ name: [{ given: ['Pat'], family: 'One' }] });
    db.prepare(
      `INSERT INTO fhir_patients (resource_id, resource_data, phone, clinic_id, name, is_deleted)
       VALUES (?, ?, ?, ?, ?, 0)`
    ).run('pat-a', payload, '+15559990001', 'clinic-a', 'Pat One');
    db.prepare(
      `INSERT INTO fhir_patients (resource_id, resource_data, phone, clinic_id, name, is_deleted)
       VALUES (?, ?, ?, ?, ?, 0)`
    ).run('pat-b', payload, '+15559990001', 'clinic-b', 'Pat One B');
  });

  afterAll(() => {
    try {
      database?.db?.close();
    } catch (_) {}
  });

  test('PmsHub clinic A never returns clinic B patient', async () => {
    const hubA = PmsHub.forClinic('clinic-a');
    const patient = await hubA.lookupPatient({ phone: '+15559990001' });
    expect(patient?.id).toBe('pat-a');
    expect(patient?.id).not.toBe('pat-b');
  });

  test('getFHIRPatientByPhone is clinic-scoped with requireClinicScope', () => {
    const a = database.getFHIRPatientByPhone('+15559990001', {
      clinicId: 'clinic-a',
      requireClinicScope: true
    });
    const b = database.getFHIRPatientByPhone('+15559990001', {
      clinicId: 'clinic-b',
      requireClinicScope: true
    });
    expect(a?.resource_id).toBe('pat-a');
    expect(b?.resource_id).toBe('pat-b');
  });
});
