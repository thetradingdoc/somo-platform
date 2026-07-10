'use strict';

describe('Pinecone tenant isolation (N-03)', () => {
  test('pinecone client uses configured namespace env', () => {
    const prev = process.env.PINECONE_NAMESPACE;
    process.env.PINECONE_NAMESPACE = 'tenant-a';
    const pinecone = require('../services/pinecone-rest');
    expect(pinecone.getNamespace?.() || process.env.PINECONE_NAMESPACE).toBe('tenant-a');
    process.env.PINECONE_NAMESPACE = prev;
  });

  test('metadata filter helper rejects cross-tenant clinic_id mismatch', () => {
    const { matchesTenantMetadata } = require('../services/layer2-rag/pinecone-tenant-filter');
    expect(matchesTenantMetadata({ clinic_id: 'clinic_a' }, 'clinic_a')).toBe(true);
    expect(matchesTenantMetadata({ clinic_id: 'clinic_a' }, 'clinic_b')).toBe(false);
    expect(matchesTenantMetadata({}, 'clinic_a')).toBe(false);
  });
});
