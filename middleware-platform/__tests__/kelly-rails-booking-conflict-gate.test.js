'use strict';

process.env.RCM_E2E_DIRECT_TOOLS = '1';
process.env.KELLY_RAILS_V2 = '1';
process.env.CONVERSATION_MODE_ROUTING = 'enforce';

const KellyToolExecutor = require('../services/kelly-tool-executor');
const { runDeterministicBookingConflict } = require('../services/kelly-rails/lanes');

describe('kelly rails booking conflict gate', () => {
  let executeSpy;

  beforeEach(() => {
    executeSpy = jest.spyOn(KellyToolExecutor, 'execute').mockImplementation(async (name) => {
      if (name === 'get_available_slots') {
        return {
          success: true,
          slot_bundles: [
            { time: '09:00', practitioner_name: 'Dr. Maria Santos', date: '2026-06-20' },
            { time: '10:15', practitioner_name: 'Dr. Other Provider', date: '2026-06-20' }
          ]
        };
      }
      return { success: true };
    });
  });

  afterEach(() => {
    executeSpy.mockRestore();
  });

  test('provider mismatch offers alternatives', async () => {
    const state = {
      session_id: 'sess_conflict',
      active_lane: 'booking',
      step: 'schedule_visit',
      locale: 'en',
      flags: {
        booking_conflict: true,
        provider_preference: 'Dr. Unknown',
        current_booking_slot: { date: '2026-06-20', time: '12:00' }
      }
    };
    const ctx = {
      sessionId: 'sess_conflict',
      clinicId: 'clinic-default',
      patientId: 'Patient/conflict-test',
      message: 'I want Dr. Unknown at 12:00'
    };

    const out = await runDeterministicBookingConflict(state, ctx);
    expect(out).toBeTruthy();
    expect(executeSpy).toHaveBeenCalledWith('get_available_slots', expect.any(Object), expect.any(Object));
    expect(out.reply).toMatch(/Dr\. Unknown|alternative|09:00|10:15/i);
    expect(state.flags.provider_mismatch).toBe(true);
  });

  test('user picks alternative clears conflict', async () => {
    const state = {
      session_id: 'sess_pick',
      active_lane: 'booking',
      step: 'schedule_visit',
      locale: 'en',
      flags: {
        booking_conflict: true,
        _conflict_slot_bundles: [
          { time: '09:00', practitioner_name: 'Dr. Santos', date: '2026-06-20' }
        ]
      }
    };
    const ctx = {
      sessionId: 'sess_pick',
      clinicId: 'clinic-default',
      patientId: 'Patient/pick-test',
      message: '09:00 works for me'
    };

    const out = await runDeterministicBookingConflict(state, ctx);
    expect(out).toBeTruthy();
    expect(state.flags.booking_conflict).toBe(false);
    expect(state.step).toBe('confirm_visit');
    expect(state.flags.current_booking_slot.time).toBe('09:00');
  });
});
