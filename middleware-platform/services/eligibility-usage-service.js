'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const { getTier } = require('./plan-catalog');

const DAILY_CAP = Number(process.env.ELIGIBILITY_DAILY_CAP || 50);

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function trackEligibilityUsage({ customerId, payerId, sessionId, quality, source = 'stedi' } = {}) {
  if (!db.db) return { tracked: false };
  try {
    db.db.prepare(`
      INSERT INTO eligibility_usage_events (id, customer_id, payer_id, session_id, source, quality, event_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(uuidv4(), customerId || null, payerId || null, sessionId || null, source, quality || null, todayKey());
    return { tracked: true };
  } catch (e) {
    console.warn('[eligibility-usage] track failed:', e.message);
    return { tracked: false, error: e.message };
  }
}

function getUsageForCustomer(customerId, opts = {}) {
  if (!db.db || !customerId) return { checks_today: 0, checks_month: 0 };
  const monthPrefix = (opts.billingMonth || todayKey().slice(0, 7)) + '%';
  const today = todayKey();
  const todayRow = db.db.prepare(`
    SELECT COUNT(*) AS n FROM eligibility_usage_events
    WHERE customer_id = ? AND event_date = ?
  `).get(customerId, today);
  const monthRow = db.db.prepare(`
    SELECT COUNT(*) AS n FROM eligibility_usage_events
    WHERE customer_id = ? AND event_date LIKE ?
  `).get(customerId, monthPrefix);
  return {
    checks_today: todayRow?.n || 0,
    checks_month: monthRow?.n || 0,
    daily_cap: DAILY_CAP
  };
}

function checkDailyCap(customerId) {
  const usage = getUsageForCustomer(customerId);
  if (usage.checks_today >= DAILY_CAP) {
    return {
      allowed: false,
      code: 'DAILY_CAP_REACHED',
      message: 'Daily verification threshold reached. Contact support to lift caps.',
      usage
    };
  }
  return { allowed: true, usage };
}

function getAllowanceForTier(tierId) {
  const tier = getTier(tierId);
  return tier.included_eligibility_checks_per_cycle ?? 0;
}

function getOverageRateForTier(tierId) {
  const tier = getTier(tierId);
  return tier.eligibility_overage_rate_usd ?? 0.35;
}

module.exports = {
  trackEligibilityUsage,
  getUsageForCustomer,
  checkDailyCap,
  getAllowanceForTier,
  getOverageRateForTier,
  DAILY_CAP
};
