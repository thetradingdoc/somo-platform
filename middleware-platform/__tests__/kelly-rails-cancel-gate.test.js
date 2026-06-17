'use strict';

process.env.RCM_E2E_DIRECT_TOOLS = '1';
process.env.KELLY_RAILS_V2 = '1';
process.env.CONVERSATION_MODE_ROUTING = 'enforce';

const KellyToolExecutor = require('../services/kelly-tool-executor');
const { executeTurn } = require('../services/kelly-rails/execute-turn');
const { runDeterministicCancel } = require('../services/kelly-rails/lanes');

describe('kelly rails cancel gate', () => {
  let executeSpy;

  beforeEach(() => {
    executeSpy = jest.spyOn(KellyToolExecutor, 'execute').mockImplementation(async (name) => {
      if (name === 'cancel_appointment') {
        return { success: true, appointment_id: 'appt_cancel_1', status: 'cancelled' };
      }
      if (name === 'search_appointments') {
        return {
          success: true,
          appointments: [{ id: 'appt_cancel_1', appointment_type: 'Dermatology', date: '2026-06-20', time: '12:00' }]
        };
      }
      return { success: true };
    });
  });

  afterEach(() => {
    executeSpy.mockRestore();
  });

  test('cancel_pending invokes cancel_appointment without LLM triage-only path', async () => {
    const state = {
      session_id: 'sess_cancel_gate',
      active_lane: 'reschedule',
      step: 'move_or_cancel',
      locale: 'en',
      flags: {
        cancel_pending: true,
        cancel_confirmed: true,
        last_appointment_id: 'appt_cancel_1'
      }
    };
    const ctx = {
      sessionId: 'sess_cancel_gate',
      clinicId: 'clinic-default',
      patientId: 'Patient/cancel-test',
      message: 'Yes please cancel it'
    };

    const out = await runDeterministicCancel(state, ctx);
    expect(out).toBeTruthy();
    expect(executeSpy).toHaveBeenCalledWith(
      'cancel_appointment',
      expect.objectContaining({ appointment_id: 'appt_cancel_1' }),
      expect.any(Object)
    );
    expect(out.toolsUsed).toContain('cancel_appointment');
    expect(out.reply).toMatch(/canceled/i);
    expect(executeSpy).not.toHaveBeenCalledWith('get_triage_session', expect.anything(), expect.anything());
  });

  test('executeTurn cancel flow reaches cancel_appointment', async () => {
    const out = await executeTurn({
      session_id: 'sess_cancel_turn',
      clinicId: 'clinic-default',
      patientId: 'Patient/cancel-turn',
      callerPhone: '+15559876543',
      message: 'Yes please cancel that appointment',
      conversation_mode: 'tenant_inbound_admin',
      active_subrail: 'cancellation',
      active_subrail_step: 'cancel_execute',
      conversation_session: {
        active_subrail: 'cancellation',
        active_subrail_step: 'cancel_execute',
        cancel_pending: true,
        cancel_confirmed: true,
        last_appointment_id: 'appt_cancel_1',
        lookup_complete: true
      },
      kelly_lane_hint: 'reschedule'
    });

    expect(executeSpy).toHaveBeenCalledWith(
      'cancel_appointment',
      expect.objectContaining({ appointment_id: expect.any(String) }),
      expect.any(Object)
    );
    expect(out.toolsUsed).toContain('cancel_appointment');
    expect(out.reply).toMatch(/canceled/i);
  });
});
