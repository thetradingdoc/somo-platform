'use strict';

const KellyToolExecutor = require('../services/kelly-tool-executor');

jest.mock('../database', () => ({
  insertHandoffEscalation: jest.fn(),
  insertKellyCallEvent: jest.fn(),
  getClinicById: () => ({ transfer_number: '+15551112222' })
}));

describe('transfer_call tool', () => {
  test('returns transfer_number when clinic PSTN configured', async () => {
    const result = await KellyToolExecutor.execute(
      'transfer_call',
      { reason: 'patient_request' },
      { sessionId: 'sess-1', clinicId: 'clinic-1', channel: 'voice' }
    );
    expect(result.success).toBe(true);
    expect(result.transfer_number).toBe('+15551112222');
    expect(result.outcome).toBe('transfer_requested');
  });
});
