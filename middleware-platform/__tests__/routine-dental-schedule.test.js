'use strict';

process.env.RCM_E2E_DIRECT_TOOLS = '1';

const KellyToolExecutor = require('../services/kelly-tool-executor');
const {
  ConversationMode,
  Subrail
} = require('../services/conversation-mode/conversation-mode-types');

jest.mock('../database', () => ({
  getTriageSession: jest.fn(() => ({
    target_specialty: 'Dental',
    triage_complete: 1,
    rag_result_id: 'rag_dental'
  })),
  insertKellyCallEvent: jest.fn(),
  setVoiceCallOutcome: jest.fn()
}));

describe('routine dental schedule_appointment', () => {
  let postSpy;

  beforeEach(() => {
    postSpy = jest.spyOn(KellyToolExecutor, '_post').mockResolvedValue({
      success: true,
      appointment: { id: 'appt_dental_1', date: '2026-07-08', time: '14:00' }
    });
    jest.spyOn(KellyToolExecutor, '_routineNoSymptomsEffective').mockReturnValue(true);
    jest.spyOn(KellyToolExecutor, '_getSessionMeta').mockImplementation((sid, key) => {
      const map = {
        target_specialty: 'Dental',
        routine_no_symptoms: '1'
      };
      return map[key] || null;
    });
    jest.spyOn(KellyToolExecutor, '_setSessionMeta').mockImplementation(() => {});
    jest.spyOn(KellyToolExecutor, '_normalizeToBusinessDate').mockImplementation((d) => d);
    jest.spyOn(KellyToolExecutor, '_httpTimeoutMs').mockReturnValue(5000);
    jest.spyOn(KellyToolExecutor, '_bumpOpsCounter').mockImplementation(() => {});
    jest.spyOn(KellyToolExecutor, '_ragConfidenceThreshold').mockReturnValue(0.5);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('posts Dental appointment_type for dental routine sessions', async () => {
    await KellyToolExecutor.execute(
      'schedule_appointment',
      {
        patient_name: 'Jennifer Walsh',
        patient_phone: '+15551234567',
        date: '2026-07-08',
        time: '14:00',
        appointment_type: 'Dental',
        specialty: 'Dental'
      },
      {
        sessionId: 'sess_dental_routine',
        clinicId: 'clinic-default',
        patientId: 'Patient/test',
        channel: 'chat',
        conversation_mode: ConversationMode.TENANT_INBOUND_ADMIN,
        active_subrail: Subrail.BOOKING
      }
    );
    expect(postSpy).toHaveBeenCalled();
    const body = postSpy.mock.calls[0][1];
    expect(body.appointment_type).toBe('Dental');
    expect(body.primary_cpt).toBe('D1110');
  });
});
