'use strict';

const { getTier } = require('./plan-catalog');

const OPERATOR_CAPABILITIES = [
  'platform.leads',
  'platform.tenants',
  'platform.tenants.delete',
  'platform.feature_flags',
  'voice.outbound_unlimited',
  'voice.inbound',
  'voice.outbound'
];

function parseCapabilitiesJson(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

/**
 * Server-verified capabilities for a customer row.
 */
function getCapabilities(customer) {
  if (!customer) return [];

  const explicit = parseCapabilitiesJson(customer.capabilities);
  if (explicit) return explicit;

  if (customer.customer_type === 'operator') {
    return OPERATOR_CAPABILITIES.slice();
  }

  const caps = ['voice.inbound'];
  const tier = getTier(customer.plan_tier || 'starter');
  if (tier.feature_flags?.outbound) {
    caps.push('voice.outbound');
  }
  if (customer.billing_enforcement_paused === 1) {
    caps.push('voice.outbound_unlimited');
  }
  return caps;
}

function hasCapability(customer, capability) {
  const caps = getCapabilities(customer);
  return caps.includes(capability);
}

function isOperatorCustomer(customer) {
  if (!customer) return false;
  if (customer.customer_type === 'operator') return true;
  return hasCapability(customer, 'platform.leads');
}

module.exports = {
  OPERATOR_CAPABILITIES,
  getCapabilities,
  hasCapability,
  isOperatorCustomer,
  parseCapabilitiesJson
};
