'use strict';

process.env.RCM_E2E_DIRECT_TOOLS = '1';
process.env.KELLY_RAILS_V2 = '1';
process.env.CONVERSATION_MODE_ROUTING = 'enforce';

const KellyToolExecutor = require('../services/kelly-tool-executor');
const { executeTurn } = require('../services/kelly-rails/execute-turn');
const { runDeterministicRecords } = require('../services/kelly-rails/lanes');

describe('kelly rails records gate', () => {
  let executeSpy;

  beforeEach(() => {
    executeSpy = jest.spyOn(KellyToolExecutor, 'execute').mockImplementation(async (name) => {
      if (name === 'query_patient_records') {
        return {
          success: true,
          answer: 'Your last visit noted mild eczema on the left arm.',
          sources: 2
        };
      }
      return { success: true };
    });
  });

  afterEach(() => {
    executeSpy.mockRestore();
  });

  test('records_qa invokes query_patient_records and replies from result', async () => {
    const state = {
      session_id: 'sess_records_gate',
      active_lane: 'records',
      step: 'records_qa',
      conversation_mode: 'tenant_records',
      locale: 'en',
      flags: {}
    };
    const ctx = {
      sessionId: 'sess_records_gate',
      clinicId: 'clinic-default',
      patientId: 'Patient/records-test',
      message: 'What did my doctor find on my last visit?'
    };

    const out = await runDeterministicRecords(state, ctx);
    expect(out).toBeTruthy();
    expect(executeSpy).toHaveBeenCalledWith(
      'query_patient_records',
      expect.objectContaining({ query: expect.stringContaining('last visit') }),
      expect.any(Object)
    );
    expect(out.toolsUsed).toContain('query_patient_records');
    expect(out.reply).toMatch(/eczema/i);
  });

  test('executeTurn tenant_records forces records gate', async () => {
    const out = await executeTurn({
      session_id: 'sess_records_turn',
      clinicId: 'clinic-default',
      patientId: 'Patient/records-turn',
      message: 'What were my lab results from last month?',
      conversation_mode: 'tenant_records',
      kelly_lane_hint: 'records',
      conversation_session: {
        conversation_mode: 'tenant_records',
        active_subrail: 'records_qa'
      }
    });

    expect(executeSpy).toHaveBeenCalledWith(
      'query_patient_records',
      expect.objectContaining({ patient_id: 'Patient/records-turn' }),
      expect.any(Object)
    );
    expect(out.toolsUsed).toContain('query_patient_records');
    expect(out.reply).toMatch(/lab|visit|records|eczema/i);
  });
});
