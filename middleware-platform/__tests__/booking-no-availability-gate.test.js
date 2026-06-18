'use strict';

process.env.RCM_E2E_DIRECT_TOOLS = '1';
process.env.KELLY_RAILS_V2 = '1';

const KellyToolExecutor = require('../services/kelly-tool-executor');
const { runDeterministicSchedule } = require('../services/kelly-rails/lanes');
const { getDeterministicReply } = require('../services/kelly-rails/prompts/deterministic');

jest.mock('../database', () => ({
  getTriageSession: jest.fn(() => ({ target_specialty: 'Dermatology' })),
  insertKellyCallEvent: jest.fn(),
  db: null
}));

describe('schedule gate no availability admission', () => {
  beforeEach(() => {
    jest.spyOn(KellyToolExecutor, 'execute').mockImplementation(async (name) => {
      if (name === 'get_available_slots') {
        return { slot_bundles: [] };
      }
      return { success: true };
    });
    jest.spyOn(KellyToolExecutor, '_getSessionMeta').mockReturnValue(null);
    jest.spyOn(KellyToolExecutor, '_setSessionMeta').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('sets no_provider_availability when get_available_slots returns empty', async () => {
    const state = {
      active_lane: 'booking',
      step: 'schedule_visit',
      locale: 'en',
      flags: {}
    };
    const ctx = {
      sessionId: 'sess_no_slots',
      patientId: 'Patient/test',
      message: 'I need an appointment next week'
    };

    const out = await runDeterministicSchedule(state, ctx);

    expect(out).toBeTruthy();
    expect(state.flags.no_provider_availability).toBe(true);
    expect(out.reply).toBe(getDeterministicReply('slots_empty', 'en'));
    expect(out.toolsUsed).toContain('get_available_slots');
  });
});
