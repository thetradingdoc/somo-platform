'use strict';

const client = require('../services/layer2-rag/pinecone-code-metadata-client');

jest.mock('../services/pinecone-rest', () => ({
  pineconeQuery: jest.fn(async () => [
    { metadata: { cpt_codes: '99214' }, score: 0.9 }
  ]),
  isPineconeConfigured: () => true
}));

jest.mock('../services/semantic-search-service', () => ({
  embedText: jest.fn(async () => new Array(1536).fill(0.1))
}));

describe('D-05 RAG_CPT_FALLBACK_PINECONE', () => {
  const origFallback = process.env.RAG_CPT_FALLBACK_PINECONE;
  const origKey = process.env.PINECONE_API_KEY;
  const origHost = process.env.PINECONE_INDEX_HOST;

  beforeEach(() => {
    process.env.RAG_CPT_FALLBACK_PINECONE = '1';
    process.env.PINECONE_API_KEY = 'test-key';
    process.env.PINECONE_INDEX_HOST = 'https://example.pinecone.io';
  });

  afterEach(() => {
    process.env.RAG_CPT_FALLBACK_PINECONE = origFallback;
    process.env.PINECONE_API_KEY = origKey;
    process.env.PINECONE_INDEX_HOST = origHost;
  });

  test('pineconeFallbackEnabled when configured', () => {
    expect(client.pineconeFallbackEnabled()).toBe(true);
    process.env.RAG_CPT_FALLBACK_PINECONE = '0';
    expect(client.pineconeFallbackEnabled()).toBe(false);
  });

  test('retrieveCodesFromPineconeMetadata returns CPT when local empty', async () => {
    const out = await client.retrieveCodesFromPineconeMetadata('chest pain follow up');
    expect(out).not.toBeNull();
    expect(out.cpt.length).toBeGreaterThan(0);
    expect(out.cpt[0].code).toBe('99214');
  });
});
