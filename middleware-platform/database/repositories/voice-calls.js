'use strict';

/**
 * Voice calls / checkouts repository slice (Phase 3).
 * Re-exports from database.js facade — migrate SQL here incrementally.
 */
const db = require('../../database');

module.exports = {
  createVoiceCheckout: db.createVoiceCheckout,
  getVoiceCheckout: db.getVoiceCheckout,
  getVoiceCheckoutByPaymentIntentId: db.getVoiceCheckoutByPaymentIntentId,
  updateVoiceCheckout: db.updateVoiceCheckout,
  getVoiceCheckoutsByMerchant: db.getVoiceCheckoutsByMerchant,
  getVoiceAgentSettings: db.getVoiceAgentSettings,
  getVoiceAgentSettingsForClinic: db.getVoiceAgentSettingsForClinic,
  getVoiceAgentSettingsByCustomer: db.getVoiceAgentSettingsByCustomer,
  getVoiceAgentSettingsForProvider: db.getVoiceAgentSettingsForProvider,
  updateVoiceCallCosts: db.updateVoiceCallCosts,
  getVoiceCallCostsByCustomer: db.getVoiceCallCostsByCustomer,
  getVoiceCallsByCustomer: db.getVoiceCallsByCustomer,
  logVoiceCall: db.logVoiceCall
};
