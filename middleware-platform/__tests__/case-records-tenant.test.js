'use strict';

const path = require('path');
const fs = require('fs');

describe('case_records tenant columns (T-006)', () => {
  let database;
  let db;

  beforeAll(() => {
    const tmp = path.join(__dirname, '..', 'tmp-test-case-tenant.db');
    try {
      fs.unlinkSync(tmp);
    } catch (_) {}
    process.env.DB_PATH = tmp;
    jest.resetModules();
    database = require('../database');
    db = database.db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS case_records (
        id TEXT PRIMARY KEY,
        case_number TEXT UNIQUE,
        patient_id TEXT,
        session_id TEXT,
        channel TEXT,
        visit_mode TEXT,
        status TEXT,
        opqrst TEXT,
        suggested_icd10 TEXT,
        created_at DATETIME
      );
    `);
    require('../migrations/071_tenant_columns_case_session_state').up(db);
  });

  afterAll(() => {
    try {
      database?.db?.close();
    } catch (_) {}
  });

  test('createCaseRecord persists clinic_id and customer_id', () => {
    const id = 'case-' + Date.now();
    database.createCaseRecord({
      id,
      case_number: 'CN-' + Date.now(),
      session_id: 'sess-1',
      clinic_id: 'clinic-verified',
      customer_id: 'cust-1'
    });
    const row = db.prepare('SELECT * FROM case_records WHERE id = ?').get(id);
    expect(row.clinic_id).toBe('clinic-verified');
    expect(row.customer_id).toBe('cust-1');
  });
});
