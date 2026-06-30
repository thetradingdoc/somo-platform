'use strict';

/**
 * Integration: voice-incoming-handler require paths and fail-closed wiring.
 */
const { createVoiceIncomingHandler } = require('../services/voice-incoming-handler');

describe('voice-incoming-handler', () => {
  const mockDb = {
    getCustomer: jest.fn(),
    getCustomerByTwilioNumber: jest.fn(),
    getClinicByPhone: jest.fn(),
    logVoiceCall: jest.fn(),
    createVoiceCall: jest.fn()
  };

  function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.type = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    return res;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SAAS_VOICE_FAIL_CLOSED = '1';
    delete process.env.SAAS_VOICE_LAZY_RETELL_ON_INBOUND;
  });

  it('fail-closed for SaaS tenant without retell_agent_id', async () => {
    mockDb.getCustomer.mockReturnValue({
      id: 'cust_saas',
      customer_type: 'saas',
      retell_agent_id: null,
      clinic_id: 'clinic-1'
    });

    const handler = createVoiceIncomingHandler({
      db: mockDb,
      normalizePhoneNumber: (p) => String(p || '').replace(/\D/g, '')
    });

    const req = {
      body: { From: '+15551234567', To: '+15559876543', CallSid: 'CA_test' },
      query: { customer_id: 'cust_saas' }
    };
    const res = mockRes();

    await handler(req, res);

    expect(res.type).toHaveBeenCalledWith('text/xml');
    const xml = res.send.mock.calls[0][0];
    expect(xml).toMatch(/Hangup/i);
    expect(xml).not.toMatch(/<Sip/i);
  });
});
