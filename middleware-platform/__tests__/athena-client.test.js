'use strict';

jest.mock('axios');

const axios = require('axios');
const { AthenaClient, clearAthenaTokenCache } = require('../services/pms/athena-client');

describe('AthenaClient', () => {
  beforeEach(() => {
    clearAthenaTokenCache();
    jest.clearAllMocks();
    process.env.ATHENA_CLIENT_ID = 'test-client';
    process.env.ATHENA_CLIENT_SECRET = 'test-secret';
    process.env.ATHENA_PRACTICE_ID = '195900';
    process.env.ATHENA_API_BASE = 'https://api.preview.platform.athenahealth.com';
    process.env.ATHENA_TOKEN_URL = 'https://api.preview.platform.athenahealth.com/oauth2/v1/token';
  });

  test('getAccessToken caches bearer token', async () => {
    axios.post.mockResolvedValueOnce({
      data: { access_token: 'tok-abc', expires_in: 3600 }
    });

    const client = new AthenaClient({}, null);
    const t1 = await client.getAccessToken();
    const t2 = await client.getAccessToken();

    expect(t1).toBe('tok-abc');
    expect(t2).toBe('tok-abc');
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('changing practice_id reuses cached token', async () => {
    axios.post.mockResolvedValueOnce({
      data: { access_token: 'tok-abc', expires_in: 3600 }
    });

    const client = new AthenaClient({}, null);
    await client.getAccessToken();
    client.config.practice_id = '80000';
    await client.getAccessToken();

    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  test('get sends authorized request to practice path', async () => {
    axios.post.mockResolvedValueOnce({
      data: { access_token: 'tok-abc', expires_in: 3600 }
    });
    axios.mockResolvedValueOnce({ data: { name: 'Test Practice' } });

    const client = new AthenaClient({}, null);
    const data = await client.get('/practiceinfo', { practiceid: '195900' });

    expect(data.name).toBe('Test Practice');
    expect(axios).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer tok-abc' })
      })
    );
  });
});
