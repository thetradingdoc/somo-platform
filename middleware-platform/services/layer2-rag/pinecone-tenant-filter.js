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

module.exports = { matchesTenantMetadata };
