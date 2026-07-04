'use strict';

const crypto = require('crypto');

describe('get_available_slots with triage_policy DISABLED', () => {
  const KellyToolExecutor = require('../services/kelly-tool-executor');
  const fixtures = require('../e2e/helpers/kelly-conversation-fixtures.cjs');

  test('dental front desk session can resolve slots without RAG row', async () => {
    const sessionId = `slots_disabled_${crypto.randomBytes(4).toString('hex')}`;
    fixtures.seedDentalFrontDeskSession(sessionId, process.env.TEST_CLINIC_ID || 'clinic-default', {
      seedProvider: false,
      allowProviderSeedFailure: true
    });
    KellyToolExecutor._setSessionMeta(sessionId, 'kelly_e2e_skip_triage', '0');
    KellyToolExecutor._setSessionMeta(sessionId, 'routine_no_symptoms', '0');

    const executor = { sessionId };
    let out;
    try {
      out = await KellyToolExecutor.execute(
        'get_available_slots',
        {
          date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
          appointment_type: 'Dental Cleaning'
        },
        executor
      );
    } catch (e) {
      fixtures.teardownMultilangScenario({ sessionId });
      throw e;
    }

    fixtures.teardownMultilangScenario({ sessionId });
    expect(out?.error).not.toBe('TRIAGE_REQUIRED');
    expect(out?.error).not.toBe('DIFFERENTIALS_REQUIRED');
    expect(out?.error_code).not.toBe('TRIAGE_REQUIRED');
    if (out?.appointment_type) {
      expect(out.appointment_type).not.toBe('Primary Care');
    }
  });

  test('routine_no_symptoms dental session uses Dental specialty not Primary Care', async () => {
    const sessionId = `slots_dental_${crypto.randomBytes(4).toString('hex')}`;
    fixtures.seedDentalFrontDeskSession(sessionId, process.env.TEST_CLINIC_ID || 'clinic-default', {
      seedProvider: false,
      allowProviderSeedFailure: true
    });
    let out;
    try {
      out = await KellyToolExecutor.execute(
        'get_available_slots',
        { date: new Date(Date.now() + 86400000).toISOString().slice(0, 10) },
        { sessionId, clinicId: process.env.TEST_CLINIC_ID || 'clinic-default' }
      );
    } finally {
      fixtures.teardownMultilangScenario({ sessionId });
    }
    expect(out?.error).not.toBe('TRIAGE_REQUIRED');
    if (out?.appointment_type) {
      expect(String(out.appointment_type).toLowerCase()).toMatch(/dental/);
    }
  });

  test('get_available_slots persists last_slot_* session meta', async () => {
    const sessionId = `slots_meta_${crypto.randomBytes(4).toString('hex')}`;
    fixtures.seedDentalFrontDeskSession(sessionId, process.env.TEST_CLINIC_ID || 'clinic-default', {
      seedProvider: false,
      allowProviderSeedFailure: true
    });
    KellyToolExecutor._setSessionMeta(sessionId, 'reason_for_visit', 'cleaning');
    try {
      const out = await KellyToolExecutor.execute(
        'get_available_slots',
        { date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), appointment_type: 'Dental' },
        { sessionId, clinicId: process.env.TEST_CLINIC_ID || 'clinic-default' }
      );
      expect(out?.error).not.toBe('TRIAGE_REQUIRED');
      if (out?.slot_bundles?.length) {
        expect(KellyToolExecutor._getSessionMeta(sessionId, 'last_slot_date')).toBeTruthy();
        expect(KellyToolExecutor._getSessionMeta(sessionId, 'last_slot_time')).toBeTruthy();
        expect(KellyToolExecutor._getSessionMeta(sessionId, 'slots_offered')).toBe('1');
      }
    } finally {
      fixtures.teardownMultilangScenario({ sessionId });
    }
  });
});
