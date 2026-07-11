'use strict';

/**
 * N-03 — filter Pinecone metadata by tenant clinic_id when present.
 */

function matchesTenantMetadata(metadata = {}, clinicId) {
  const expected = String(clinicId || '').trim();
  if (!expected) return false;
  const actual = String(metadata.clinic_id || metadata.tenant_id || '').trim();
  if (!actual) return false;
  return actual === expected;
}

/**
 * MT-03 — include global codebook vectors (no clinic_id) and tenant-matching chunks;
 * exclude chunks tagged for a different clinic.
 */
function allowsPineconeMatchForClinic(metadata = {}, clinicId) {
  const expected = String(clinicId || '').trim();
  if (!expected) return true;
  const actual = String(metadata.clinic_id || metadata.tenant_id || '').trim();
  if (!actual) return true;
  return actual === expected;
}

module.exports = { matchesTenantMetadata, allowsPineconeMatchForClinic };
