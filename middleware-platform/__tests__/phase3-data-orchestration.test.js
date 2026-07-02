'use strict';

const { matchPatient, normalizePhone } = require('../services/patient-match-service');
const { parseCsv, rosterImportKey } = require('../services/tenant-roster-service');
const { shouldBlock1upHealthForClinic, resolveOfficeType } = require('../services/dental-ehr-routing-guard');
const { buildPpoReadback } = require('../services/ppo-readback-service');

describe('phase3-data-orchestration', () => {
  test('normalizePhone formats US numbers', () => {
    expect(normalizePhone('5551234567')).toBe('+15551234567');
  });

  test('parseCsv reads header rows', () => {
    const rows = parseCsv('full_name,phone\nJane,+15551234567');
    expect(rows).toHaveLength(1);
    expect(rows[0].full_name).toBe('Jane');
  });

  test('rosterImportKey is stable per clinic+phone', () => {
    const key = rosterImportKey('c1', { phone: '+15551234567' });
    expect(key).toContain('c1:phone:');
  });

  test('matchPatient returns no_match without db rows', () => {
    const r = matchPatient({ clinicId: 'missing', phone: '+19998887777' });
    expect(r.status).toBe('no_match');
  });

  test('dental guard blocks 1upHealth for dental office_type', () => {
    const db = require('../database');
    if (!db.db) return;
    db.db
      .prepare(
        `INSERT OR REPLACE INTO clinics (clinic_id, name, slug, office_type, pms_type, pms_enabled)
         VALUES (?, ?, ?, ?, ?, 1)`
      )
      .run('test-dental-guard', 'Test Dental', 'test-dental-guard', 'dental', 'somo');
    expect(shouldBlock1upHealthForClinic('test-dental-guard')).toBe(true);
    expect(resolveOfficeType('test-dental-guard')).toBe('dental');
  });

  test('buildPpoReadback still works for eligibility handoff', () => {
    const line = buildPpoReadback({ copay: 30, eligible: true, planSummary: 'PPO' });
    expect(line).toContain('copay');
  });
});
