'use strict';

const {
  buildDefaultInboundGreeting,
  buildDefaultOutboundOpener,
  resolvePracticeDisplayName
} = require('../voice/call-opener-resolver');
const { getOperatorCustomerId, isOutboundCallType } = require('../voice/voice-account-resolution');
const { isOperatorCustomer } = require('../platform/customer-capabilities');

/**
 * Resolve merchant id for voice settings / outbound (cust:key fallback).
 */
function resolveVoiceMerchantId(db, customer) {
  if (!customer) return null;
  if (customer.merchant_id) return customer.merchant_id;
  return db.customerVoiceSettingsMerchantKey(customer.id);
}

function ensureVoiceSettingsMerchantKey(db, customer) {
  if (!customer?.id) return null;
  const merchantKey = resolveVoiceMerchantId(db, customer);
  if (!merchantKey) return null;
  if (!db.getMerchant(merchantKey)) {
    db.createMerchant({
      id: merchantKey,
      name: customer.company_name || customer.name || 'Somo Operator',
      api_key: `operator-${String(customer.id).slice(5, 17)}`,
      api_url: process.env.API_BASE_URL || 'https://api.callsomo.com',
      enabled_platforms: ['voice'],
      status: 'active'
    });
  }
  return merchantKey;
}

/**
 * Bootstrap operator row: company_name, merchant link, voice_agent_settings.
 */
function ensureOperatorTenantBootstrap(db, customerId = null) {
  const operatorId = customerId || getOperatorCustomerId();
  if (!operatorId) return null;

  let customer = db.getCustomer(operatorId);
  if (!customer) return null;

  const customerPatch = {};
  if (!customer.company_name || String(customer.company_name).toLowerCase() === 'somo owner') {
    customerPatch.company_name = 'Somo';
  }
  if (!customer.name || /somo owner/i.test(customer.name)) {
    customerPatch.name = customerPatch.name || 'Somo Operator';
  }
  if (Object.keys(customerPatch).length) {
    db.updateCustomer(operatorId, customerPatch);
    customer = db.getCustomer(operatorId);
  }

  const merchantKey = ensureVoiceSettingsMerchantKey(db, customer);
  if (merchantKey && !customer.merchant_id) {
    db.updateCustomer(operatorId, { merchant_id: merchantKey });
    customer = db.getCustomer(operatorId);
  }

  const practiceName = resolvePracticeDisplayName(db, { customer });
  const settings = db.getVoiceAgentSettingsForProvider({
    merchantId: customer.merchant_id || merchantKey,
    customerId: customer.id
  });

  const patch = {
    greeting: settings?.greeting || buildDefaultInboundGreeting(practiceName, 'warm'),
    outbound_opener: settings?.outbound_opener || buildDefaultOutboundOpener(practiceName, 'warm'),
    outbound_enabled: 1
  };

  db.upsertVoiceAgentSettings(merchantKey, { ...(settings || {}), ...patch }, customer.id);

  return { customerId: operatorId, merchantId: merchantKey, customer: db.getCustomer(operatorId) };
}

/**
 * Outbound call_type for authenticated customer.
 */
function resolveOutboundCallTypeForCustomer(customer) {
  if (!customer) return 'operator_outbound';
  if (customer.customer_type === 'operator' || isOperatorCustomer(customer)) {
    return 'operator_outbound';
  }
  return 'rcm_follow_up';
}

/**
 * Whether outbound_enabled gate can be skipped (system / operator outbound).
 */
function isSystemOutboundCallType(callType) {
  const t = String(callType || '').toLowerCase();
  return (
    t === 'operator_outbound' ||
    t === 'sales_outbound' ||
    t === 'rcm_follow_up' ||
    isOutboundCallType(t)
  );
}

function isOperatorOutboundCustomer(customer) {
  return customer?.customer_type === 'operator' || isOperatorCustomer(customer);
}

module.exports = {
  resolveVoiceMerchantId,
  ensureVoiceSettingsMerchantKey,
  ensureOperatorTenantBootstrap,
  resolveOutboundCallTypeForCustomer,
  isSystemOutboundCallType,
  isOperatorOutboundCustomer
};
