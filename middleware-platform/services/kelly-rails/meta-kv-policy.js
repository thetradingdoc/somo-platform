'use strict';

/**
 * Phase 1 — block orchestration keys from kelly_session_meta_kv (SITE-32).
 * Commerce/payment keys remain writable.
 */

const ORCHESTRATION_KEYS = new Set([
  'conversation_mode',
  'active_subrail',
  'routing_world',
  'kelly_graph_branch',
  'kelly_orchestrator_phase',
  'kelly_graph_step',
  'kelly_graph_active',
  'kelly_rails_v2',
  'last_gate_matched',
  'kelly_session_locale',
  'kelly_triage_reopen',
  'skincare_post_intake',
  'intake_complete',
  'routine_intake_active'
]);

/** Keys allowed in meta_kv mirror (commerce/checkout only). */
const COMMERCE_EXEMPT_KEYS = new Set([
  'checkout_stage',
  'checkout_stage_updated_at_ms',
  'checkout_stage_meta',
  'checkout_context_version',
  'checkout_context_version_updated_at_ms',
  'checkout_context_version_reason',
  'payment_token',
  'payment_status_source',
  'payment_status_last_checked_at',
  'verified_transition_inflight',
  'verified_transition_id',
  'verified_transition_ts',
  'commerce_email_pending',
  'commerce_email_pending_nonce',
  'commerce_email_verified',
  'commerce_email_verified_nonce',
  'commerce_email_verified_at_ms',
  'commerce_email_verified_context_version',
  'commerce_verified_cart_fingerprint',
  'commerce_shipping_complete',
  'commerce_shipping_context_version',
  'commerce_shipping_cart_fingerprint',
  'last_appointment_id'
]);

function isCommerceMetaKey(key) {
  const k = String(key || '').trim();
  if (COMMERCE_EXEMPT_KEYS.has(k)) return true;
  return k.startsWith('checkout_stage_meta_');
}

function isOrchestrationMetaKey(key) {
  return ORCHESTRATION_KEYS.has(String(key || '').trim());
}

/**
 * @returns {boolean} true when write is allowed
 */
function assertMetaKvWriteAllowed(key, { fromMirror = false, sessionId = null } = {}) {
  if (fromMirror) return true;
  if (!isOrchestrationMetaKey(key)) return true;

  const msg = `[meta_kv_orchestration_write_blocked] key=${key} session=${sessionId || 'n/a'}`;
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd || process.env.META_KV_POLICY_STRICT === '1') {
    throw new Error(msg);
  }
  console.error(msg);
  return false;
}

module.exports = {
  ORCHESTRATION_KEYS,
  COMMERCE_EXEMPT_KEYS,
  isOrchestrationMetaKey,
  isCommerceMetaKey,
  assertMetaKvWriteAllowed
};
