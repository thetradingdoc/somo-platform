'use strict';

jest.mock('../services/pms/athena-client');

const { AthenaClient } = require('../services/pms/athena-client');
const { AthenaAdapter } = require('../services/pms/athena-adapter');

describe('AthenaAdapter', () => {
  let mockClient;

  beforeEach(() => {
    process.env.ATHENA_CLIENT_ID = 'cid';
    process.env.ATHENA_CLIENT_SECRET = 'sec';
    process.env.ATHENA_PRACTICE_ID = '195900';
    process.env.ATHENA_DEPARTMENT_ID = '1';

    mockClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      config: { practice_id: '195900', department_id: '1' }
    };
    AthenaClient.mockImplementation(() => mockClient);
  });

  test('healthCheck returns ok when practiceinfo succeeds', async () => {
    mockClient.get.mockResolvedValueOnce({ name: 'Sandbox Practice' });
    const adapter = new AthenaAdapter('clinic-test', {});
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.pms_type).toBe('athena');
  });

  test('healthCheck fails without credentials', async () => {
    delete process.env.ATHENA_CLIENT_ID;
    delete process.env.ATHENA_CLIENT_SECRET;
    delete process.env.ATHENA_PRACTICE_ID;
    const adapter = new AthenaAdapter('clinic-test', {});
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(false);
  });

  test('getSchedule maps open appointment slots', async () => {
    mockClient.get.mockResolvedValueOnce({
      appointments: [{ starttime: '10:00' }, { starttime: '14:30' }]
    });

    const adapter = new AthenaAdapter('clinic-test', {
      client_id: 'cid',
      client_secret: 'sec',
      practice_id: '195900',
      department_id: '1',
      default_appointmenttype_id: '82'
    });
    const schedule = await adapter.getSchedule({
      date: '2026-07-15',
      appointment_type: 'General Consult'
    });

    expect(schedule.success).toBe(true);
    expect(schedule.available_slots.length).toBe(2);
  });
});
