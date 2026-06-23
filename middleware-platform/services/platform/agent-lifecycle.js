'use strict';

/**
 * Single writer for Kelly + Retell + voice_agent_settings enabled state (W2-07).
 */

const db = require('../../database');

function updateAgentLifecycleState(customerId, { kelly, retell, enabled } = {}) {
  if (!customerId) {
    return { success: false, error: 'customer_id required' };
  }
  const customer = db.getCustomer(customerId);
  if (!customer) {
    return { success: false, error: 'customer not found' };
  }

  const patch = {};
  if (kelly !== undefined) patch.kelly_status = kelly;
  if (retell !== undefined) patch.retell_agent_status = retell;
  if (Object.keys(patch).length) {
    db.updateCustomer(customerId, patch);
  }

  const merchantId = customer.merchant_id;
  if (enabled !== undefined && merchantId) {
    const settings = db.getVoiceAgentSettingsForProvider({ merchantId, customerId }) || {};
    db.upsertVoiceAgentSettings(merchantId, {
      ...settings,
      enabled: enabled ? 1 : 0
    }, customerId);
  } else if (enabled !== undefined && !merchantId) {
    const custKey = db.customerVoiceSettingsMerchantKey(customerId);
    const settings = db.getVoiceAgentSettings(custKey) || {};
    db.upsertVoiceAgentSettings(custKey, { ...settings, enabled: enabled ? 1 : 0 }, customerId);
  }

  return { success: true, customer: db.getCustomer(customerId) };
}

module.exports = { updateAgentLifecycleState };
