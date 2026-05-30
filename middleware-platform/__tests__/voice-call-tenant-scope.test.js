'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

describe('voice call tenant scope', () => {
  let database;
  let db;
  const customerId = 'cust_test_voice_scope';

  beforeAll(() => {
    const tmp = path.join(__dirname, '..', 'tmp-test-voice-tenant.db');
    try {
      fs.unlinkSync(tmp);
    } catch (_) {}
    process.env.DB_PATH = tmp;
    jest.resetModules();
    database = require('../database');
    db = database.db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, email TEXT);
      CREATE TABLE IF NOT EXISTS clinics (clinic_id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE IF NOT EXISTS voice_call_log (
        id TEXT PRIMARY KEY, call_id TEXT, customer_id TEXT, clinic_id TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.prepare('INSERT OR IGNORE INTO customers (id, email) VALUES (?, ?)').run(customerId, 'test@voice.local');
    db.prepare('INSERT OR IGNORE INTO clinics (clinic_id, name) VALUES (?, ?)').run('clinic-test', 'Test Clinic');

    require('../migrations/053_voice_call_tenant_columns').up(db);
  });

  afterAll(() => {
    try {
      if (database?.db) database.db.close();
    } catch (_) {}
  });

  it('upsertCallState persists customer_id when column exists', () => {
    const callId = 'call_test_' + Date.now();
    database.upsertCallState(callId, {
      clinic_id: 'clinic-test',
      customer_id: customerId,
      current_stage: 'INTAKE',
      state_data: { ok: true }
    });
    const row = database.getCallState(callId);
    assert.strictEqual(row.customer_id, customerId);
  });

  it('getCallState returns same customer_id after upsertCallState', () => {
    const callId = 'call_shared_' + Date.now();
    database.upsertCallState(callId, {
      customer_id: customerId,
      clinic_id: 'clinic-test',
      current_stage: 'INTAKE'
    });
    const stateRow = database.getCallState(callId);
    assert.strictEqual(stateRow.customer_id, customerId);
    assert.strictEqual(stateRow.clinic_id, 'clinic-test');
  });
});
