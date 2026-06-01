'use strict';

/**
 * Commerce checkout repository slice (P3 decomposition).
 * Re-exports checkout session helpers from database.js — migrate callers here over time.
 */
const db = require('../database');

module.exports = {
  createCheckoutSession: db.createCheckoutSession,
  getCheckoutSession: db.getCheckoutSession,
  updateCheckoutSession: db.updateCheckoutSession,
  purgeExpiredCheckoutSessions: db.purgeExpiredCheckoutSessions,
  purgeOrphanedCommerceFlowSessions: db.purgeOrphanedCommerceFlowSessions,
  getCheckoutSessionsByKellySessionId: db.getCheckoutSessionsByKellySessionId,
  upsertCommerceCheckoutProgress: db.upsertCommerceCheckoutProgress,
  getCommerceCheckoutProgress: db.getCommerceCheckoutProgress
};
