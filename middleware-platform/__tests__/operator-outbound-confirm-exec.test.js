'use strict';

process.env.KELLY_RAILS_V2 = '1';

const mockRunConversationDispatch = jest.fn();

jest.mock('../services/conversation-mode/conversation-mode-session', () => ({
  runConversationDispatch: (...args) => mockRunConversationDispatch(...args),
  emitDisposition: jest.fn(() => 'appointment_confirmed')
}));

jest.mock('../services/kelly-rails/orchestrator', () => ({
  handleTurn: jest.fn(async () => ({ reply: 'unexpected orchestrator path' }))
}));

jest.mock('../services/kelly-agent-service', () => ({
  processTurn: jest.fn()
}));

jest.mock('../services/kelly-conversation-graph', () => ({
  shouldUseKellyGraph: jest.fn(() => false)
}));

jest.mock('../services/kelly-conversation-bridge', () => ({
  runKellyConversationTurn: jest.fn()
}));

const { Handoff } = require('../services/conversation-mode/handoff-types');
const db = require('../database');
const BookingService = require('../services/booking-service');
const KellyToolExecutor = require('../services/kelly-tool-executor');
const { runKellyTurn } = require('../services/kelly-turn-resolver');

describe('operator outbound confirm execution', () => {
  const env = { ...process.env };
  let executeSpy;

  beforeEach(async () => {
    process.env.KELLY_RAILS_V2 = '1';
    process.env.NODE_ENV = 'test';
    jest.clearAllMocks();

    db.db
      .prepare(
        `INSERT OR REPLACE INTO appointments (
          id, clinic_id, patient_name, patient_phone, patient_email, appointment_type,
          date, time, start_time, end_time, duration_minutes, provider, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        'apt_confirm_exec_1',
        'clinic-test',
        'Jane',
        '+15551234567',
        'jane@test.com',
        'cleaning',
        '2026-07-02',
        '10:00 AM',
        '2026-07-02T10:00:00',
        '2026-07-02T10:30:00',
        30,
        'Dr Test',
        'scheduled'
      );

    executeSpy = jest.spyOn(KellyToolExecutor, '_executeToolCore').mockImplementation(async (toolName, args, ctx) => {
      if (toolName === 'confirm_appointment') {
        return BookingService.confirmAppointment(args.appointment_id, ctx.clinicId);
      }
      return { success: false };
    });

    mockRunConversationDispatch.mockResolvedValue({
      enforce: true,
      handoff: Handoff.SCRIPT_ONLY,
      session: {
        conversation_mode: 'operator_outbound',
        active_subrail: null,
        active_subrail_step: 'update'
      },
      dispatch: {
        reply: 'Perfect — you are all set.',
        endCall: true,
        handoff: Handoff.SCRIPT_ONLY,
        disposition: 'appointment_confirmed',
        toolsUsed: [
          {
            name: 'confirm_appointment',
            args: {
              appointment_id: 'apt_confirm_exec_1',
              confirmed_by: 'patient',
              method: 'outbound_call'
            }
          }
        ]
      }
    });
  });

  afterEach(() => {
    process.env = { ...env };
    executeSpy?.mockRestore();
  });

  test('scriptOnly path executes confirm_appointment and updates appointment status', async () => {
    const out = await runKellyTurn({
      sessionId: 'sess-outbound-confirm-exec',
      clinicId: 'clinic-test',
      message: 'yes I will be there',
      skipIdentityAdmission: true,
      call_type: 'outbound',
      direction: 'outbound'
    });

    expect(executeSpy).toHaveBeenCalledWith(
      'confirm_appointment',
      expect.objectContaining({ appointment_id: 'apt_confirm_exec_1' }),
      expect.objectContaining({ sessionId: 'sess-outbound-confirm-exec', clinicId: 'clinic-test' })
    );
    expect(out.toolsUsed).toContain('confirm_appointment');

    const row = await db.getAppointment('apt_confirm_exec_1', 'clinic-test');
    expect(row.status).toBe('confirmed');
  });
});
