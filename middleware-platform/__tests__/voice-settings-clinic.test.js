'use strict';

const path = require('path');
const fs = require('fs');

describe('voice_agent_settings clinic override (T-007)', () => {
  let database;
  let db;

  beforeAll(() => {
    const tmp = path.join(__dirname, '..', 'tmp-test-voice-settings-clinic.db');
    try {
      fs.unlinkSync(tmp);
    } catch (_) {}
    process.env.DB_PATH = tmp;
    jest.resetModules();
    database = require('../database');
    db = database.db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS voice_agent_settings (
        merchant_id TEXT PRIMARY KEY,
        retell_agent_id TEXT,
        enabled INTEGER DEFAULT 1,
        greeting TEXT,
        after_hours_message TEXT,
        business_hours TEXT,
        customer_id TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.prepare(
      `INSERT INTO voice_agent_settings (merchant_id, greeting) VALUES (?, ?)`
    ).run('merchant-1', 'Default merchant greeting');
    require('../migrations/072_voice_agent_settings_clinic').up(db);

    db.prepare(
      `INSERT INTO voice_agent_settings (id, merchant_id, clinic_id, greeting)
       VALUES (?, ?, ?, ?)`
    ).run('merchant-1:clinic-a', 'merchant-1', 'clinic-a', 'Clinic A custom greeting');
  });

  afterAll(() => {
    try {
      database?.db?.close();
    } catch (_) {}
  });

  test('clinic row overrides merchant default', () => {
    const row = database.getVoiceAgentSettingsForProvider({
      merchantId: 'merchant-1',
      clinicId: 'clinic-a'
    });
    expect(row.greeting).toBe('Clinic A custom greeting');
  });

  test('merchant fallback when no clinic row', () => {
    const row = database.getVoiceAgentSettingsForProvider({
      merchantId: 'merchant-1',
      clinicId: 'clinic-other'
    });
    expect(row.greeting).toBe('Default merchant greeting');
  });

  test('upsertVoiceAgentSettings creates clinic override row (R-01)', () => {
    database.upsertVoiceAgentSettings(
      'merchant-1',
      { greeting: 'Clinic B greeting' },
      null,
      { clinicId: 'clinic-b' }
    );
    const row = database.getVoiceAgentSettingsForProvider({
      merchantId: 'merchant-1',
      clinicId: 'clinic-b'
    });
    expect(row.greeting).toBe('Clinic B greeting');
    database.upsertVoiceAgentSettings(
      'merchant-1',
      { greeting: 'Clinic B updated' },
      null,
      { clinicId: 'clinic-b' }
    );
    const updated = database.getVoiceAgentSettingsForProvider({
      merchantId: 'merchant-1',
      clinicId: 'clinic-b'
    });
    expect(updated.greeting).toBe('Clinic B updated');
  });
});
