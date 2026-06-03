'use strict';

jest.mock('../services/outbound-call-service', () => ({
  initiateSomoDemoDemoCall: jest.fn(async () => ({ call_id: 'CA_TEST_123' }))
}));

const { getUseCaseContext, requestDemoCall } = require('../services/somo-demo-service');

describe('somo-demo-service', () => {
  test('getUseCaseContext returns label and opener per use case', () => {
    const ctx = getUseCaseContext('appointment_setter');
    expect(ctx.use_case_label).toBe('Appointment Setter');
    expect(ctx.use_case_opener).toMatch(/appointment/i);
  });

  test('unknown use case falls back to receptionist opener', () => {
    const ctx = getUseCaseContext('unknown');
    expect(ctx.use_case_opener).toMatch(/receptionist/i);
  });

  test('requestDemoCall defaults empty use_case to medical_clinic', async () => {
    process.env.SOMO_DEMO_ENABLED = '1';
    process.env.SOMO_DEMO_RELAX_LIMITS = '1';
    process.env.NODE_ENV = 'test';

    const phone = `+1416${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    const result = await requestDemoCall({
      name: 'Default Case',
      phone,
      consent: true,
      clientIp: '127.0.0.2',
      attribution: {}
    });
    expect(result.success).toBe(true);
    const db = require('../database');
    const row = db.getSomoDemoRequest(result.demo_request_id);
    expect(row.use_case).toBe('medical_clinic');
  });

  test('duplicate phone within 24h is blocked with deterministic error code', async () => {
    process.env.SOMO_DEMO_ENABLED = '1';
    process.env.SOMO_DEMO_RELAX_LIMITS = '0';
    process.env.NODE_ENV = 'test';

    const payload = {
      name: 'Test Lead',
      phone: `+1415${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
      use_case: 'medical_clinic',
      consent: true,
      clientIp: '127.0.0.1',
      attribution: { utm_source: 'jest' }
    };

    const first = await requestDemoCall(payload);
    expect(first.success).toBe(true);
    expect(first.call_id).toBe('CA_TEST_123');

    await expect(requestDemoCall(payload)).rejects.toMatchObject({
      code: 'DUPLICATE_PHONE_WINDOW',
      status: 429
    });
  });
});
