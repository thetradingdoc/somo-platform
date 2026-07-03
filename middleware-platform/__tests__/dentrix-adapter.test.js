'use strict';

jest.mock('../services/pms/dentrix-client');

const { DentrixClient } = require('../services/pms/dentrix-client');
const { DentrixAdapter } = require('../services/pms/dentrix-adapter');

describe('DentrixAdapter', () => {
  let mockClient;

  beforeEach(() => {
    process.env.DENTRIX_CLIENT_ID = 'cid';
    process.env.DENTRIX_CLIENT_SECRET = 'sec';
    process.env.DENTRIX_ORGANIZATION_ID = 'org-123';

    mockClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      unwrap: jest.fn((x) => x?.data ?? x),
      config: { organization_id: 'org-123', location_id: 'loc-1' }
    };
    DentrixClient.mockImplementation(() => mockClient);
  });

  afterEach(() => {
    delete process.env.DENTRIX_CLIENT_ID;
    delete process.env.DENTRIX_CLIENT_SECRET;
    delete process.env.DENTRIX_ORGANIZATION_ID;
  });

  test('healthCheck returns ok when linked org matches', async () => {
    mockClient.get.mockResolvedValueOnce({ organizations: ['org-123'] });
    const adapter = new DentrixAdapter('clinic-test', {});
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.pms_type).toBe('dentrix');
  });

  test('healthCheck fails without credentials', async () => {
    delete process.env.DENTRIX_CLIENT_ID;
    delete process.env.DENTRIX_CLIENT_SECRET;
    delete process.env.DENTRIX_ORGANIZATION_ID;
    const adapter = new DentrixAdapter('clinic-test', {});
    const health = await adapter.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.message).toMatch(/credentials/i);
  });

  test('getSchedule returns default open slots when no appointments', async () => {
    mockClient.get.mockResolvedValueOnce({ data: [] });
    mockClient.unwrap.mockReturnValueOnce([]);
    const adapter = new DentrixAdapter('clinic-test', {
      client_id: 'cid',
      client_secret: 'sec',
      organization_id: 'org-123'
    });
    const schedule = await adapter.getSchedule({ date: '2026-08-01' });
    expect(schedule.success).toBe(true);
    expect(schedule.available_slots.length).toBeGreaterThan(0);
  });

  test('getSchedule fails closed when appointment read errors', async () => {
    mockClient.get.mockRejectedValueOnce(new Error('forbidden'));
    const adapter = new DentrixAdapter('clinic-test', {
      client_id: 'cid',
      client_secret: 'sec',
      organization_id: 'org-123'
    });
    await expect(adapter.getSchedule({ date: '2026-08-01' })).rejects.toThrow(/forbidden/i);
  });

  test('lookupPatient sanitizes filter injection in email', async () => {
    mockClient.get.mockResolvedValueOnce({ data: [] });
    mockClient.unwrap.mockReturnValueOnce([]);
    const adapter = new DentrixAdapter('clinic-test', {
      client_id: 'cid',
      client_secret: 'sec',
      organization_id: 'org-123'
    });
    await adapter.lookupPatient({
      email: 'evil@example.com,firstName~=HACKED'
    });
    expect(mockClient.get).toHaveBeenCalledWith(
      '/v1/patients',
      expect.objectContaining({
        filter: 'email==evil@example.comfirstNameHACKED'
      })
    );
  });
});
