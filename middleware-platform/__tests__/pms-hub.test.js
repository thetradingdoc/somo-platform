'use strict';

const { PmsHub, clearContextCache } = require('../services/pms/pms-hub');
const { getClinicPmsSettings, updateClinicPms } = require('../services/pms/pms-store');
const { encryptPmsConfig } = require('../services/pms/pms-config');

const TEST_CLINIC = 'clinic-pms-test-' + Date.now();

describe('PMS hub', () => {
  beforeAll(() => {
    const db = require('../database');
    if (!db.db) return;
    db.db.prepare(`
      INSERT OR REPLACE INTO clinics (clinic_id, name, slug, is_active, pms_type, pms_enabled)
      VALUES (?, 'PMS Test Clinic', ?, 1, 'somo', 1)
    `).run(TEST_CLINIC, `pms-test-${Date.now()}`);
    clearContextCache();
  });

  afterAll(() => {
    const db = require('../database');
    if (!db.db) return;
    try {
      db.db.prepare('DELETE FROM clinics WHERE clinic_id = ?').run(TEST_CLINIC);
    } catch (_) {}
  });

  test('forClinic resolves somo adapter', async () => {
    const hub = PmsHub.forClinic(TEST_CLINIC);
    expect(hub.pmsType).toBe('somo');
    const health = await hub.healthCheck();
    expect(health.ok).toBe(true);
  });

  test('getPatientContext degrades without phone', async () => {
    const hub = PmsHub.forClinic(TEST_CLINIC);
    const ctx = await hub.getPatientContext({ call_id: 'test-call-1' });
    expect(ctx.success).toBe(true);
    expect(ctx.patient).toBeNull();
  });

  test('admin pms settings round-trip', () => {
    updateClinicPms(TEST_CLINIC, {
      pms_type: 'somo',
      pms_enabled: 1,
      pms_config: encryptPmsConfig({ mirror_google: true })
    });
    const settings = getClinicPmsSettings(TEST_CLINIC);
    expect(settings.pms_type).toBe('somo');
    expect(settings.pms_config.mirror_google).toBe(true);
  });

  test('athena adapter health without full credentials', async () => {
    updateClinicPms(TEST_CLINIC, {
      pms_type: 'athena',
      pms_enabled: 1,
      pms_config: encryptPmsConfig({ client_id: 'x', client_secret: 'y' })
    });
    const hub = PmsHub.forClinic(TEST_CLINIC);
    const health = await hub.healthCheck();
    expect(health.ok).toBe(false);
    updateClinicPms(TEST_CLINIC, { pms_type: 'somo', pms_enabled: 1 });
  });

  test('pms_type none returns null from tryForClinic', () => {
    updateClinicPms(TEST_CLINIC, { pms_type: 'none', pms_enabled: 0 });
    expect(PmsHub.tryForClinic(TEST_CLINIC)).toBeNull();
    updateClinicPms(TEST_CLINIC, { pms_type: 'somo', pms_enabled: 1 });
  });
});
