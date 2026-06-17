'use strict';

process.env.RCM_E2E_DIRECT_TOOLS = '1';
process.env.KELLY_RAILS_V2 = '1';
process.env.CONVERSATION_MODE_ROUTING = 'enforce';

const KellyToolExecutor = require('../services/kelly-tool-executor');
const { executeTurn } = require('../services/kelly-rails/execute-turn');
const { runDeterministicReschedule } = require('../services/kelly-rails/lanes');

describe('kelly rails reschedule gate', () => {
  let executeSpy;

  beforeEach(() => {
    executeSpy = jest.spyOn(KellyToolExecutor, 'execute').mockImplementation(async (name) => {
      if (name === 'reschedule_appointment') {
        return {
          success: true,
          appointment_id: 'appt_resched_1',
          date: '2026-06-25',
          time: '14:00'
        };
      }
      if (name === 'search_appointments') {
        return {
          success: true,
          appointments: [{ id: 'appt_resched_1', appointment_type: 'Dermatology', date: '2026-06-20', time: '12:00' }]
        };
      }
      return { success: true };
    });
  });

  afterEach(() => {
    executeSpy.mockRestore();
  });

  test('reschedule_pending invokes reschedule_appointment with parsed slot', async () => {
    const state = {
      session_id: 'sess_resched_gate',
      active_lane: 'reschedule',
      step: 'move_or_cancel',
      locale: 'en',
      flags: {
        reschedule_pending: true,
        last_appointment_id: 'appt_resched_1',
        lookup_complete: true,
        current_booking_slot: { date: '2026-06-25', time: '14:00' }
      }
    };
    const ctx = {
      sessionId: 'sess_resched_gate',
      clinicId: 'clinic-default',
      patientId: 'Patient/resched-test',
      message: 'Please move it to 2026-06-25 at 14:00'
    };

    const out = await runDeterministicReschedule(state, ctx);
    expect(out).toBeTruthy();
    expect(executeSpy).toHaveBeenCalledWith(
      'reschedule_appointment',
      expect.objectContaining({
        appointment_id: 'appt_resched_1',
        new_date: '2026-06-25',
        new_time: '14:00'
      }),
      expect.any(Object)
    );
    expect(out.toolsUsed).toContain('reschedule_appointment');
    expect(out.reply).toMatch(/rescheduled/i);
  });

  test('executeTurn reschedule flow reaches reschedule_appointment', async () => {
    KellyToolExecutor._setSessionMeta('sess_resched_turn', 'last_slot_date', '2026-06-25');
    KellyToolExecutor._setSessionMeta('sess_resched_turn', 'last_slot_time', '14:00');

    const out = await executeTurn({
      session_id: 'sess_resched_turn',
      clinicId: 'clinic-default',
      patientId: 'Patient/resched-turn',
      callerPhone: '+15558765432',
      message: 'Yes please reschedule to 2026-06-25 at 14:00',
      conversation_mode: 'tenant_inbound_admin',
      active_subrail: 'cancellation',
      conversation_session: {
        active_subrail: 'cancellation',
        active_subrail_step: 'find_booking',
        reschedule_pending: true,
        last_appointment_id: 'appt_resched_1',
        lookup_complete: true
      },
      kelly_lane_hint: 'reschedule'
    });

    expect(executeSpy).toHaveBeenCalledWith(
      'reschedule_appointment',
      expect.objectContaining({ new_date: '2026-06-25', new_time: '14:00' }),
      expect.any(Object)
    );
    expect(out.toolsUsed).toContain('reschedule_appointment');
  });
});
