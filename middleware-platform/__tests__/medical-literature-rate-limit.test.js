'use strict';

process.env.PUBMED_MIN_INTERVAL_MS = '0';
process.env.PUBMED_MAX_CALLS_PER_SESSION = '3';
process.env.MEDICAL_LITERATURE_SEARCH_ENABLED = 'true';

jest.mock('axios', () => ({
  get: jest.fn().mockResolvedValue({
    data: { esearchresult: { idlist: [] } }
  })
}));

const { searchPubMed } = require('../services/medical-literature-search-service');

describe('PubMed per-session rate limit', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('returns session_rate_limited after max calls for same session', async () => {
    const sid = `jest-pubmed-cap-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      const r = await searchPubMed('diabetes trial', { sessionId: sid });
      expect(r.success).toBe(true);
    }
    const blocked = await searchPubMed('diabetes trial', { sessionId: sid });
    expect(blocked.success).toBe(false);
    expect(blocked.error).toBe('session_rate_limited');
  });
});
