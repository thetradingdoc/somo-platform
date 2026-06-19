'use strict';

const path = require('path');
const fs = require('fs');

describe('fhir patient clinic scope (T-005)', () => {
  let database;
  let db;

  beforeAll(() => {
    const tmp = path.join(__dirname, '..', 'tmp-test-fhir-clinic.db');
    try {
      fs.unlinkSync(tmp);
    } catch (_) {}
    process.env.DB_PATH = tmp;
    jest.resetModules();
    database = require('../database');
    db = database.db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS fhir_patients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        resource_id TEXT UNIQUE NOT NULL,
        resource_data TEXT NOT NULL,
        phone TEXT,
        merchant_id TEXT,
        clinic_id TEXT,
        is_deleted INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    require('../migrations/070_fhir_patients_clinic_id').up(db);
    try {
      db.exec('DROP INDEX IF EXISTS idx_fhir_patients_phone_active');
    } catch (_) {}

    const payload = JSON.stringify({ name: [{ given: ['A'], family: 'One' }] });
    db.prepare(
      `INSERT INTO fhir_patients (resource_id, resource_data, phone, clinic_id, merchant_id)
       VALUES (?, ?, ?, ?, ?)`
    ).run('pat-clinic-a', payload, '+15550001111', 'clinic-a', 'merchant-1');
    db.prepare(
      `INSERT INTO fhir_patients (resource_id, resource_data, phone, clinic_id, merchant_id)
       VALUES (?, ?, ?, ?, ?)`
    ).run('pat-clinic-b', payload, '+15550001111', 'clinic-b', 'merchant-1');
  });

  afterAll(() => {
    try {
      database?.db?.close();
    } catch (_) {}
  });

  test('same phone returns clinic-scoped row when clinicId provided', () => {
    const a = database.getFHIRPatientByPhone('+15550001111', { clinicId: 'clinic-a' });
    const b = database.getFHIRPatientByPhone('+15550001111', { clinicId: 'clinic-b' });
    expect(a?.resource_id).toBe('pat-clinic-a');
    expect(b?.resource_id).toBe('pat-clinic-b');
  });

  test('clinicId without match returns null (no global fallback)', () => {
    const missing = database.getFHIRPatientByPhone('+15550001111', { clinicId: 'clinic-z' });
    expect(missing).toBeNull();
  });
});
