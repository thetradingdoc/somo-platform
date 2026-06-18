'use strict';

process.env.RCM_E2E_DIRECT_TOOLS = '1';
process.env.KELLY_RAILS_V2 = '1';

const KellyToolExecutor = require('../services/kelly-tool-executor');
const { runDeterministicSchedule } = require('../services/kelly-rails/lanes');
const { getDeterministicReply } = require('../services/kelly-rails/prompts/deterministic');

jest.mock('../database', () => ({
  getTriageSession: jest.fn(() => ({ target_specialty: 'Dermatology' })),
  db: null
}));

jest.mock('../services/kelly-rails/appointment-read', () => ({
  readAppointmentRowById: jest.fn(() => null),
  formatAppointmentWhen: jest.fn((row) =>
    row ? [row.appointment_date, row.appointment_time].filter(Boolean).join(' at ') : ''
  )
}));

describe('schedule gate booking_confirmed without tool', () => {
  let executeSpy;
  const { readAppointmentRowById } = require('../services/kelly-rails/appointment-read');

  beforeEach(() => {
    executeSpy = jest.spyOn(KellyToolExecutor, 'execute').mockResolvedValue({ success: true });
    jest.spyOn(KellyToolExecutor, '_getSessionMeta').mockImplementation((sid, key) => {
      const map = {
        last_slot_id: 'slot_1',
        last_slot_date: '2026-06-20',
        last_slot_time: '14:00'
      };
      return map[key] || null;
    });
    jest.spyOn(KellyToolExecutor, '_setSessionMeta').mockImplementation(() => {});
    readAppointmentRowById.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns booking_confirmed when schedule_appointment_success without calling schedule tool', async () => {
    const state = {
      active_lane: 'booking',
      step: 'confirm_visit',
      locale: 'en',
      flags: {
        schedule_appointment_success: true,
        current_booking_slot: { slot_id: 'real_slot_1', date: '2026-06-20', time: '14:00' }
      }
    };
    const ctx = {
      sessionId: 'sess_confirm_no_tool',
      patientId: 'Patient/test',
      message: 'yes please confirm'
    };

    const out = await runDeterministicSchedule(state, ctx);

    expect(out).toBeTruthy();
    expect(out.reply).toBe(
      getDeterministicReply('booking_confirmed', 'en', { when: '2026-06-20 at 14:00' })
    );
    expect(executeSpy).not.toHaveBeenCalledWith('schedule_appointment', expect.anything(), expect.anything());
  });

  test('returns booking_confirmed when existing appointment id without calling schedule tool', async () => {
    readAppointmentRowById.mockReturnValue({
      id: 'appt_existing_1',
      appointment_date: '2026-07-01',
      appointment_time: '09:30'
    });

    const state = {
      active_lane: 'booking',
      step: 'confirm_visit',
      locale: 'en',
      flags: {
        appointment_id: 'appt_existing_1',
        current_booking_slot: { slot_id: 'real_slot_1', date: '2026-06-20', time: '14:00' }
      }
    };
    const ctx = {
      sessionId: 'sess_existing_appt',
      patientId: 'Patient/test',
      message: 'yes book it'
    };

    const out = await runDeterministicSchedule(state, ctx);

    expect(out).toBeTruthy();
    expect(out.reply).toMatch(/confirmed/i);
    expect(executeSpy).not.toHaveBeenCalledWith('schedule_appointment', expect.anything(), expect.anything());
  });

  test('confirm without schedule_appointment_success does not return booking_confirmed before tool completes', async () => {
    executeSpy.mockResolvedValue({ success: false, error: 'slot_taken' });

    const state = {
      active_lane: 'booking',
      step: 'confirm_visit',
      locale: 'en',
      flags: {
        current_booking_slot: { slot_id: 'real_slot_1', date: '2026-06-20', time: '14:00' }
      }
    };
    const ctx = {
      sessionId: 'sess_no_short_circuit',
      patientId: 'Patient/test',
      message: 'yes please confirm'
    };

    const out = await runDeterministicSchedule(state, ctx);

    if (out?.reply) {
      expect(out.reply).not.toBe(
        getDeterministicReply('booking_confirmed', 'en', { when: '2026-06-20 at 14:00' })
      );
    }
    expect(state.flags.schedule_appointment_success).toBeFalsy();
  });

  test('calls schedule_appointment when no prior success or existing appointment', async () => {
    executeSpy.mockImplementation(async (name) => {
      if (name === 'schedule_appointment') {
        return {
          success: true,
          appointment_id: 'appt_new_1',
          date: '2026-06-20',
          time: '14:00'
        };
      }
      if (name === 'get_available_slots') {
        return {
          slot_bundles: [
            { id: 'real_slot_1', date: '2026-06-20', time: '14:00', practitioner_name: 'Dr. Test' }
          ]
        };
      }
      return { success: true };
    });

    const state = {
      active_lane: 'booking',
      step: 'confirm_visit',
      locale: 'en',
      flags: {
        current_booking_slot: { slot_id: 'real_slot_1', date: '2026-06-20', time: '14:00' }
      }
    };
    const ctx = {
      sessionId: 'sess_needs_schedule',
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
