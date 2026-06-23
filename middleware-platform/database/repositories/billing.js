'use strict';

/**
 * Billing / usage repository slice (Phase 7).
 */
const db = require('../../database');

module.exports = {
  getClinicMonthlyLlmCost: db.getClinicMonthlyLlmCost.bind(db),
  getClinicMonthlyCostCap: db.getClinicMonthlyCostCap.bind(db),
};
