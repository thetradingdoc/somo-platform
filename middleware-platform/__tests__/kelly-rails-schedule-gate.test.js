'use strict';

process.env.RCM_E2E_DIRECT_TOOLS = '1';
process.env.KELLY_RAILS_V2 = '1';

const { isConfirmatoryUtterance } = require('../services/kelly-rails/confirm-utterance');
const KellyToolExecutor = require('../services/kelly-tool-executor');
const { runDeterministicSchedule } = require('../services/kelly-rails/lanes');

jest.mock('../database', () => ({
  getTriageSession: jest.fn(() => ({ target_specialty: 'Dermatology' }))
}));

describe('deterministic schedule gate', () => {
  let executeSpy;

  beforeEach(() => {
    executeSpy = jest.spyOn(KellyToolExecutor, 'execute').mockImplementation(async (name) => {
      if (name === 'schedule_appointment') {
        return {
          success: true,
          appointment_id: 'appt_sched_gate_1',
          date: '2026-06-20',
          time: '14:00'
        };
      }
      return { success: true };
    });
    jest.spyOn(KellyToolExecutor, '_getSessionMeta').mockImplementation((sid, key) => {
      const map = {
        last_slot_id: 'slot_1',
        last_slot_date: '2026-06-20',
        last_slot_time: '14:00',
        collected_name: 'Tom Harris'
      };
      return map[key] || null;
    });
    jest.spyOn(KellyToolExecutor, '_setSessionMeta').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('isConfirmatoryUtterance detects yes', () => {
    expect(isConfirmatoryUtterance('yes that works')).toBe(true);
    expect(isConfirmatoryUtterance('no thanks')).toBe(false);
  });

  test('normalizes corrupted slot time before scheduling', async () => {
    const state = {
      active_lane: 'booking',
      step: 'schedule_visit',
      locale: 'en',
      flags: {
        current_booking_slot: {
          slot_id: 'slot_1',
          date: '2026-06-20',
          time: '14:00 with dr. smith works for me'
        }
      }
    };
    const ctx = {
      sessionId: 'sess_sched_corrupt',
      patientId: 'Patient/test',
      message: 'yes please book that'
    };
    const out = await runDeterministicSchedule(state, ctx);
    expect(out).toBeTruthy();
    expect(executeSpy).toHaveBeenCalledWith(
      'schedule_appointment',
      expect.objectContaining({ time: '14:00' }),
      expect.any(Object)
    );
  });

  test('schedules on schedule_visit when slot set and user confirms', async () => {
    const state = {
      active_lane: 'booking',
      step: 'schedule_visit',
      locale: 'en',
      flags: {
        current_booking_slot: { slot_id: 'slot_1', date: '2026-06-20', time: '14:00' }
      }
    };
    const ctx = {
      sessionId: 'sess_sched_gate',
      patientId: 'Patient/test',
      message: 'yes that works for me'
    };
    const out = await runDeterministicSchedule(state, ctx);
    expect(out).toBeTruthy();
    expect(executeSpy).toHaveBeenCalledWith(
      'schedule_appointment',
      expect.objectContaining({ date: '2026-06-20', time: '14:00' }),
      expect.any(Object)
    );
    expect(state.flags.schedule_appointment_success).toBe(true);
  });
});
