'use strict';

/**
 * Resolve which voice "world" a call belongs to — demo, tenant, operator outbound, etc.
 */

const { getOperatorCustomerId } = require('./voice-account-resolution');

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

  if (callType === 'somo_demo' || (direction !== 'outbound' && isDemoLineToNumber(toNumber))) {
    return 'demo';
  }

  if (
    callType === 'operator_outbound' ||
    callType === 'sales_outbound' ||
    direction === 'outbound'
  ) {
    return callType === 'sales_outbound' ? 'sales_outbound' : 'operator_outbound';
  }

  if (customerId && operatorId && customerId === operatorId && isDemoLineToNumber(toNumber)) {
    return 'platform_support';
  }

  if (customerId && customer?.customer_type === 'operator') {
    return 'platform_support';
  }

  if (customerId) {
    return 'tenant';
  }

  return 'unidentified';
}

/** Tenant mode seeding requires customer_id — clinic_id alone is not enough (R-5b). */
function isTenantResolvedForMode(customerId) {
  return !!(customerId && String(customerId).trim());
}

/** Kelly Rails must not run for demo or unidentified inbound. */
function shouldBlockKellyTurn(routingWorld) {
  const world = routingWorld || 'unidentified';
  return world === 'demo' || world === 'unidentified';
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
  normalizePhone,
  isDemoLineToNumber,
  resolveRoutingWorld,
  isTenantResolvedForMode,
  shouldBlockKellyTurn,
  emitRoutingWorldEvent
};
