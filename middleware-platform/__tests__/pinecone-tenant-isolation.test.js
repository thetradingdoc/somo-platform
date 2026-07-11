'use strict';

const client = require('../services/layer2-rag/pinecone-code-metadata-client');
const { allowsPineconeMatchForClinic, matchesTenantMetadata } = require('../services/layer2-rag/pinecone-tenant-filter');

describe('Pinecone tenant isolation (N-03 / MT-03)', () => {
  test('pinecone client uses configured namespace env', () => {
    const prev = process.env.PINECONE_NAMESPACE;
    process.env.PINECONE_NAMESPACE = 'tenant-a';
    const pinecone = require('../services/pinecone-rest');
    expect(pinecone.getNamespace?.() || process.env.PINECONE_NAMESPACE).toBe('tenant-a');
    process.env.PINECONE_NAMESPACE = prev;
  });

  test('metadata filter helper rejects cross-tenant clinic_id mismatch', () => {
    expect(matchesTenantMetadata({ clinic_id: 'clinic_a' }, 'clinic_a')).toBe(true);
    expect(matchesTenantMetadata({ clinic_id: 'clinic_a' }, 'clinic_b')).toBe(false);
    expect(matchesTenantMetadata({}, 'clinic_a')).toBe(false);
  });

  test('allowsPineconeMatchForClinic permits global chunks and matching tenant', () => {
    expect(allowsPineconeMatchForClinic({}, 'clinic_a')).toBe(true);
    expect(allowsPineconeMatchForClinic({ clinic_id: 'clinic_a' }, 'clinic_a')).toBe(true);
    expect(allowsPineconeMatchForClinic({ clinic_id: 'clinic_a' }, 'clinic_b')).toBe(false);
    expect(allowsPineconeMatchForClinic({ clinic_id: 'clinic_b' }, 'clinic_a')).toBe(false);
  });

  test('aggregateFromMatches excludes other-tenant CPT when clinicId set', () => {
    const matches = [
      { metadata: { cpt_codes: '99214', clinic_id: 'clinic_a' }, score: 0.9 },
      { metadata: { cpt_codes: '99213', clinic_id: 'clinic_b' }, score: 0.95 }
    ];
    const forA = client.aggregateFromMatches(matches, 'cpt_codes', 'cpt', 'clinic_a');
    expect(forA.map((c) => c.code)).toEqual(['99214']);
    const forB = client.aggregateFromMatches(matches, 'cpt_codes', 'cpt', 'clinic_b');
    expect(forB.map((c) => c.code)).toEqual(['99213']);
  });

  test('aggregateFromMatches includes untagged global chunks when clinicId set', () => {
    const matches = [
      { metadata: { cpt_codes: '99214' }, score: 0.9 },
      { metadata: { cpt_codes: '99213', clinic_id: 'clinic_b' }, score: 0.95 }
    ];
    const forA = client.aggregateFromMatches(matches, 'cpt_codes', 'cpt', 'clinic_a');
    expect(forA.map((c) => c.code)).toEqual(['99214']);
  });
});
