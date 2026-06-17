'use strict';

process.env.RCM_E2E_DIRECT_TOOLS = '1';
process.env.KELLY_RAILS_V2 = '1';
process.env.CONVERSATION_MODE_ROUTING = 'enforce';

const KellyToolExecutor = require('../services/kelly-tool-executor');
const { runDeterministicCancel, transitionToRebookBooking } = require('../services/kelly-rails/lanes');

describe('kelly rails cancel rebook gate', () => {
  let executeSpy;

  beforeEach(() => {
    executeSpy = jest.spyOn(KellyToolExecutor, 'execute').mockImplementation(async (name) => {
      if (name === 'cancel_appointment') {
        return { success: true, appointment_id: 'appt_rebook_1', status: 'cancelled' };
      }
      if (name === 'get_available_slots') {
        return {
          success: true,
          slot_bundles: [{ time: '14:00', practitioner_name: 'Dr. Santos', date: '2026-06-20' }]
        };
      }
      return { success: true };
    });
  });

  afterEach(() => {
    executeSpy.mockRestore();
  });

  test('cancel with rebook_after_cancel transitions to booking lane', async () => {
    const state = {
      session_id: 'sess_rebook_gate',
      active_lane: 'reschedule',
      step: 'move_or_cancel',
      locale: 'en',
      flags: {
        cancel_pending: true,
        cancel_confirmed: true,
        rebook_after_cancel: true,
        last_appointment_id: 'appt_rebook_1'
      }
    };
    const ctx = {
      sessionId: 'sess_rebook_gate',
      clinicId: 'clinic-default',
      patientId: 'Patient/rebook-test',
      message: 'Yes cancel and book a new time'
    };

    const out = await runDeterministicCancel(state, ctx);
    expect(out).toBeTruthy();
    expect(executeSpy).toHaveBeenCalledWith(
      'cancel_appointment',
      expect.objectContaining({ appointment_id: 'appt_rebook_1' }),
      expect.any(Object)
    );
    expect(state.active_lane).toBe('booking');
    expect(state.step).toBe('schedule_visit');
    expect(out.reply).toMatch(/canceled.*new time/i);
  });

  test('transitionToRebookBooking clears cancel flags', () => {
    const state = {
      flags: { cancel_pending: true, reschedule_pending: true },
      active_lane: 'reschedule',
      step: 'move_or_cancel'
    };
    transitionToRebookBooking(state);
    expect(state.active_lane).toBe('booking');
    expect(state.flags.cancel_pending).toBe(false);
    expect(state.flags.reschedule_pending).toBe(false);
  });

});
