/**
 * Low-balance alerts (20% of included cycle minutes) for voice subscription billing.
 */

const db = require('../../database');
const { getLowBalanceThresholdMinutes } = require('../platform/apply-usage');
const { getTotalAvailableMinutes } = require('../platform/apply-usage');
const EmailService = require('../platform/email-service');

function maybeSendLowBalanceAlert(customerId) {
  const customer = db.getCustomer(customerId);
  if (!customer || customer.billing_enforcement_paused === 1) return;

  const minutes = getTotalAvailableMinutes(db, customerId);
  const threshold = getLowBalanceThresholdMinutes(db, customer);
  if (minutes > threshold) return;

  const lastAlert = customer.last_low_balance_alert_at;
  if (lastAlert) {
    const dayMs = 24 * 60 * 60 * 1000;
    if (Date.now() - new Date(lastAlert).getTime() < dayMs) return;
  }

  const email = customer.email;
  if (!email) return;

  const portal = (process.env.ADMIN_PORTAL_BASE_URL || process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
  const subject = 'Somo voice minutes running low';
  const body = `Hi ${customer.name || customer.company_name || 'there'},\n\n` +
    `Your voice receptionist has about ${minutes} minute(s) remaining this cycle ` +
    `(alert threshold: ${threshold} min).\n\n` +
    `Add a top-up or review your plan: ${portal}/business/settings.html\n\n` +
    '— Somo';

  EmailService.sendEmail({ to: email, subject, text: body, html: `<pre>${body}</pre>` })
    .then(() => {
      db.updateCustomer(customerId, { last_low_balance_alert_at: new Date().toISOString() });
      console.log(`[VoiceBilling] Low balance alert sent to ${customerId}`);
    })
    .catch((err) => {
      console.warn('[VoiceBilling] Low balance email failed:', err.message);
    });
}

module.exports = { maybeSendLowBalanceAlert };
