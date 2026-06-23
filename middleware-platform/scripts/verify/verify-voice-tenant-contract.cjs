#!/usr/bin/env node
'use strict';

/**
 * Voice tenant contract gate (replaces deleted Jest __tests__/voice-* suite).
 * Run: META_KV_POLICY_STRICT=1 node scripts/verify/verify-voice-tenant-contract.cjs
 */

const path = require('path');
const { execSync } = require('child_process');

const MP = path.join(__dirname, '..', '..');
process.chdir(MP);

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.META_KV_POLICY_STRICT = process.env.META_KV_POLICY_STRICT || '1';
process.env.SKIP_STARTUP_MIGRATIONS = process.env.SKIP_STARTUP_MIGRATIONS || '1';
process.env.DB_PATH = process.env.DB_PATH || ':memory:';

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    console.error(`✗ ${msg}`);
    failed += 1;
    return false;
  }
  console.log(`✓ ${msg}`);
  return true;
}

// --- voice-call-context ---
const {
  buildVoiceCallContext,
  canUseClinicId,
  runtimeClinicId,
  canPrepopulatePatient,
  canRunKelly,
  toRetellMetadata
} = require('../../services/voice/voice-call-context');
const { SiteContextStatus } = require('../../services/voice/call-site-context');

const verified = buildVoiceCallContext({
  site_context_status: SiteContextStatus.VERIFIED,
  clinic_id: 'clinic-a',
  clinic_id_source: 'did',
  customer_id: 'cust-1'
});
assert(canUseClinicId(verified), 'verified context allows clinic id');
assert(runtimeClinicId(verified) === 'clinic-a', 'runtimeClinicId returns verified clinic');
assert(canPrepopulatePatient(verified), 'canPrepopulatePatient when verified');
assert(canRunKelly(verified), 'canRunKelly when verified');
const meta = toRetellMetadata(verified);
assert(meta.clinic_id === 'clinic-a' && meta.site_context_status === 'verified', 'toRetellMetadata includes clinic');

const ambiguous = buildVoiceCallContext({ site_context_status: SiteContextStatus.AMBIGUOUS, clinic_id: 'clinic-a' });
assert(!canUseClinicId(ambiguous), 'ambiguous context blocks clinic id');
assert(runtimeClinicId(ambiguous) === null, 'runtimeClinicId null when ambiguous');

// --- meta-kv-policy ---
const { assertMetaKvWriteAllowed, isCommerceMetaKey } = require('../../services/kelly/rails/meta-kv-policy');
assert(isCommerceMetaKey('checkout_stage'), 'commerce meta keys exempt');
try {
  assertMetaKvWriteAllowed('conversation_mode', { sessionId: 's1' });
  assert(false, 'orchestration meta key must throw under META_KV_POLICY_STRICT');
} catch (e) {
  assert(e.message.includes('meta_kv_orchestration_write_blocked'), 'orchestration write blocked');
}
assert(assertMetaKvWriteAllowed('checkout_stage', { sessionId: 's1' }), 'commerce write allowed');

// --- voice-identity-admission / outbound ---
const { evaluateIdentityAdmission } = require('../../services/voice/voice-identity-admission');
const outboundOk = evaluateIdentityAdmission({
  call_type: 'operator_outbound',
  direction: 'outbound',
  customer_id: 'cust-1',
  clinic_id: 'clinic-a',
  site_context_status: 'verified',
  tenantResolved: true
});
assert(outboundOk.admitted === true, 'outbound admitted when site verified');

const outboundBad = evaluateIdentityAdmission({
  call_type: 'operator_outbound',
  direction: 'outbound',
  customer_id: 'cust-1',
  site_context_status: 'ambiguous',
  tenantResolved: true
});
assert(outboundBad.admitted === false && outboundBad.reason === 'site_context_not_verified', 'outbound blocked when site ambiguous');

const inboundBad = evaluateIdentityAdmission({
  call_type: 'tenant',
  direction: 'inbound',
  site_context_status: 'ambiguous',
  tenantResolved: true,
  customer_id: 'cust-1'
});
assert(inboundBad.admitted === false, 'inbound tenant blocked when site ambiguous');

// --- fhir voice lookup clinic scope ---
const { findFHIRPatientForVoice } = require('../../services/shared/fhir-voice-lookup');
assert(typeof findFHIRPatientForVoice === 'function', 'findFHIRPatientForVoice exported');

// --- saas tenant provision ---
const { provisionSaasTenant } = require('../../services/shared/saas-tenant-provision');
assert(typeof provisionSaasTenant === 'function', 'provisionSaasTenant exported');

// --- voice routing world tenant resolution ---
const { isTenantResolvedForMode } = require('../../services/voice/voice-routing-world');
assert(isTenantResolvedForMode('cust-abc') === true, 'tenant resolved when customer id present');
assert(isTenantResolvedForMode(null) === false, 'tenant unresolved without customer id');

console.log('\n==> audit-voice-fhir-callers');
try {
  execSync('node scripts/audit-voice-fhir-callers.cjs', { cwd: MP, stdio: 'inherit' });
} catch (_) {
  failed += 1;
}

if (failed) {
  console.error(`\n${failed} voice-tenant contract check(s) failed`);
  process.exit(1);
}
console.log('\n✓ voice-tenant contract OK');
