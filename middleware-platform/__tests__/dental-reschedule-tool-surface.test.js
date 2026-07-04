'use strict';

const { USE_CASE_PROFILES } = require('../services/prompt-profile-templates');
const fixtures = require('../e2e/helpers/kelly-conversation-fixtures.cjs');
const { SUBRAIL_ALLOWED_EXTRA } = require('../services/conversation-mode/mode-tool-firewall');
const { Subrail } = require('../services/conversation-mode/conversation-mode-types');

describe('dental reschedule tool surface', () => {
  test('canonical dental template includes cancel, search, reschedule', () => {
    const tools = USE_CASE_PROFILES.dental.allowed_tools;
    expect(tools).toContain('reschedule_appointment');
    expect(tools).toContain('cancel_appointment');
    expect(tools).toContain('search_appointments');
  });

  test('E2E dental profile seed includes reschedule_appointment', () => {
    const sessionId = `prof_surface_${Date.now()}`;
    fixtures.seedDentalFrontDeskSession(sessionId, 'clinic-default', { seedProvider: false });
    const { dbModule } = fixtures.loadDb();
    const row = dbModule.db
      ?.prepare(
        `SELECT allowed_tools FROM prompt_profiles WHERE clinic_id = ? ORDER BY updated_at DESC LIMIT 1`
      )
      .get('clinic-default');
    const tools = JSON.parse(row?.allowed_tools || '[]');
    expect(tools).toContain('reschedule_appointment');
    fixtures.teardownMultilangScenario({ sessionId });
  });

  test('CANCELLATION subrail allows reschedule_appointment', () => {
    const allowed = SUBRAIL_ALLOWED_EXTRA[Subrail.CANCELLATION];
    expect(allowed.has('reschedule_appointment')).toBe(true);
  });
});
