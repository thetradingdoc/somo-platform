'use strict';

/**
 * Voice call / routing repository slice (RS-2-03).
 */
const db = require('../../database');

module.exports = {
  logVoiceCall: db.logVoiceCall,
  getVoiceCallsByCustomer: db.getVoiceCallsByCustomer,
  updateVoiceCallCosts: db.updateVoiceCallCosts,
  getVoiceCallCostsByCustomer: db.getVoiceCallCostsByCustomer,
};
