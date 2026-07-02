'use strict';

/**
 * Internal ops alerts when tenants approach eligibility allowance (pilot).
 */

const { getUsageForCustomer } = require('./eligibility-usage-service');
const { getIncludedEligibilityChecks } = require('./plan-catalog');

function checkEligibilityUsageAlert(customerId, planTier = 'practice') {
  const allowance = getIncludedEligibilityChecks(planTier) || 400;
  const usage = getUsageForCustomer(customerId);
  const pct = allowance > 0 ? usage.checks_month / allowance : 0;
  if (pct >= 0.8) {
    const alert = {
      level: pct >= 0.95 ? 'critical' : 'warning',
      message: `Eligibility usage ${usage.checks_month}/${allowance} (${Math.round(pct * 100)}%)`,
      usage,
      allowance,
      pct
    };
    notifyEligibilityAlert(customerId, alert);
    return alert;
  }
  return null;
}

function notifyEligibilityAlert(customerId, alert) {
  console.log(JSON.stringify({
    component: 'eligibility_usage_alert',
    customer_id: customerId,
    level: alert.level,
    message: alert.message,
    pct: alert.pct
  }));
  const webhook = process.env.ELIGIBILITY_ALERT_SLACK_WEBHOOK;
  if (!webhook) return;
  try {
    const axios = require('axios');
    axios
      .post(webhook, { text: `[Somo] ${alert.message} (customer ${customerId})` }, { timeout: 5000 })
      .catch(() => {});
  } catch (_) {}
}

module.exports = { checkEligibilityUsageAlert, notifyEligibilityAlert };
