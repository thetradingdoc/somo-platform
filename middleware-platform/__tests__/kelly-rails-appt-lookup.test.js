'use strict';

process.env.RCM_E2E_DIRECT_TOOLS = '1';
process.env.KELLY_RAILS_V2 = '1';
process.env.CONVERSATION_MODE_ROUTING = 'enforce';

const KellyToolExecutor = require('../services/kelly-tool-executor');
const { executeTurn } = require('../services/kelly-rails/execute-turn');

describe('kelly rails appt lookup gate', () => {
  let executeSpy;

  beforeEach(() => {
    executeSpy = jest.spyOn(KellyToolExecutor, 'execute').mockImplementation(async (name) => {
      if (name === 'search_appointments') {
        return {
          success: true,
          appointments: [
            {
              id: 'appt_1',
              appointment_type: 'Dermatology',
              appointment_date: '2026-06-20',
              appointment_time: '12:00'
            }
          ]
        };
      }
      return { success: true };
    });
  });

  afterEach(() => {
    executeSpy.mockRestore();
  });

  test('appt_lookup_only forces search_appointments before reply', async () => {
    KellyToolExecutor.execute.mockImplementation(async (name) => {
      if (name === 'search_appointments') {
        return {
          success: true,
          appointments: [
            {
              id: 'appt_1',
              appointment_type: 'Dermatology',
              appointment_date: '2026-06-20',
              appointment_time: '12:00'
            }
          ]
        };
      }
      return { success: true };
    });

    const out = await executeTurn({
      session_id: 'sess_lookup_test',
      clinicId: 'clinic-default',
      patientId: 'Patient/test',
      callerPhone: '+15551234567',
      message: 'I am calling about my appointment',
      conversation_session: {
        appt_lookup_only: true,
        active_subrail: 'cancellation',
        active_subrail_step: 'find_booking',
        conversation_mode: 'tenant_inbound_admin'
      },
      conversation_mode: 'tenant_inbound_admin',
      active_subrail: 'cancellation'
    });

    expect(executeSpy).toHaveBeenCalledWith(
      'search_appointments',
      expect.objectContaining({ clinic_id: 'clinic-default' }),
      expect.any(Object)
    );
    expect(out.reply).toMatch(/Dermatology|12:00|appointment/i);
    expect(out.toolsUsed).toContain('search_appointments');
  });
});
