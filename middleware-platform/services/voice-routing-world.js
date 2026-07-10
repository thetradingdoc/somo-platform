'use strict';

/**
 * Resolve which voice "world" a call belongs to — demo, tenant, operator outbound, navigation, etc.
 */

const { getOperatorCustomerId } = require('./voice-account-resolution');

/** Sixth routing world — P1-S1 wires resolveRoutingWorld logic. */
const ROUTING_WORLD_NAVIGATION = 'navigation';

function normalizePhone(n) {
  if (!n) return '';
  const SMSService = require('./sms-service');
  try {
    return SMSService.formatPhoneNumber(String(n).trim());
  } catch {
    return String(n).trim();
  }
}

function isDemoLineToNumber(toNumber) {
  if (!toNumber) return false;
  try {
    const { isDemoTwilioNumber } = require('./somo-demo-template-registry');
    return isDemoTwilioNumber(normalizePhone(toNumber));
  } catch {
    return false;
  }
}

/**
 * @param {object} opts
 * @param {string} [opts.call_type]
 * @param {string} [opts.direction]
 * @param {string} [opts.to_number]
 * @param {string} [opts.customer_id]
 * @param {object} [opts.customer]
 */
function resolveRoutingWorld(opts = {}) {
  const callType = String(opts.call_type || '').toLowerCase();
  const direction = String(opts.direction || '').toLowerCase();
  const toNumber = normalizePhone(opts.to_number);
  const customerId = opts.customer_id ? String(opts.customer_id) : null;
  const customer = opts.customer || null;
  const operatorId = getOperatorCustomerId();

  // Explicit demo call_type always wins (landing outbound webhook).
  if (callType === 'somo_demo') {
    return 'demo';
  }

  if (
    callType === 'operator_outbound' ||
    callType === 'sales_outbound' ||
    direction === 'outbound'
  ) {
    return callType === 'sales_outbound' ? 'sales_outbound' : 'operator_outbound';
  }

  if (
    callType === 'consumer_navigation' ||
    customer?.customer_type === 'navigation'
  ) {
    return ROUTING_WORLD_NAVIGATION;
  }

  if (callType === 'platform_support' || customer?.customer_type === 'operator') {
    return 'platform_support';
  }

  if (customerId && operatorId && customerId === operatorId) {
    return 'platform_support';
  }

  // Demo DID fallback only when not already claimed by navigation/support/tenant.
  if (direction !== 'outbound' && isDemoLineToNumber(toNumber)) {
    return 'demo';
  }

  if (customerId) {
    return 'tenant';
  }

  return 'unidentified';
}

/** Tenant mode: customer_id or resolvable clinic_id (inbound tenant). */
function isTenantResolvedForMode(customerIdOrOpts, clinicIdLegacy) {
  if (typeof customerIdOrOpts === 'object' && customerIdOrOpts !== null) {
    const { isTenantIdentityResolved } = require('./voice-identity-admission');
    return isTenantIdentityResolved(customerIdOrOpts);
  }
  if (customerIdOrOpts && String(customerIdOrOpts).trim()) return true;
  if (clinicIdLegacy) {
    const { isTenantIdentityResolved } = require('./voice-identity-admission');
    const db = require('../database');
    return isTenantIdentityResolved({ clinicId: clinicIdLegacy, db });
  }
  return false;
}

/** Kelly Rails must not run for demo, navigation, platform support, or unidentified inbound. */
function shouldBlockKellyTurn(routingWorld) {
  const world = routingWorld || 'unidentified';
  return (
    world === 'demo' ||
    world === ROUTING_WORLD_NAVIGATION ||
    world === 'platform_support' ||
    world === 'unidentified'
  );
}

function emitRoutingWorldEvent(db, { session_id, call_id, routing_world, extra = {} }) {
  console.log(
    `[routing_world] call=${call_id || session_id} world=${routing_world}`,
    extra?.to_number ? `to=${extra.to_number}` : ''
  );
  try {
    db?.insertKellyCallEvent?.({
      session_id: session_id || null,
      call_id: call_id || null,
      event_type: 'routing_world_resolved',
      payload_json: { routing_world, ...extra }
    });
  } catch (_) {}
}

module.exports = {
  ROUTING_WORLD_NAVIGATION,
  normalizePhone,
  isDemoLineToNumber,
  resolveRoutingWorld,
  isTenantResolvedForMode,
  shouldBlockKellyTurn,
  emitRoutingWorldEvent
};
