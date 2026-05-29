'use strict';

const db = require('../database');
const EmailService = require('./email-service');
const SMSService = require('./sms-service');
const {
  isTrialSimEnabledForCustomer,
  getTrialMinutesAllocated,
  getTrialMinutesRemaining,
  getTrialMinutesConsumed,
  isDodgecallSignup
} = require('./trial-lifecycle');
const { getTrialDurationDays } = require('./plan-catalog');

function portalBase() {
  return (
    process.env.ADMIN_PORTAL_BASE_URL ||
    process.env.BASE_URL ||
    'http://localhost:4000'
  ).replace(/\/$/, '');
}

function subscribeUrl() {
  return `${portalBase()}/business/settings.html?billing=subscribe`;
}

async function sendTrialNudge(customer, nudgeKey, { smsBody, emailSubject, emailText }) {
  const channels = [];

  if (smsBody && customer.phone_number) {
    if (!db.hasTrialNudgeBeenSent(customer.id, nudgeKey, 'sms')) {
      try {
        await SMSService.sendSMS(customer.phone_number, smsBody);
        db.recordTrialNudge(customer.id, nudgeKey, 'sms');
        channels.push('sms');
      } catch (e) {
        console.warn('[TrialAlerts] SMS failed:', e.message);
      }
    }
  }

  if (emailText && customer.email) {
    if (!db.hasTrialNudgeBeenSent(customer.id, nudgeKey, 'email')) {
      try {
        await EmailService.sendEmail({
          to: customer.email,
          subject: emailSubject,
          text: emailText,
          html: `<pre>${emailText}</pre>`
        });
        db.recordTrialNudge(customer.id, nudgeKey, 'email');
        channels.push('email');
      } catch (e) {
        console.warn('[TrialAlerts] email failed:', e.message);
      }
    }
  }

  return channels;
}

function maybeSendTrialUsageNudges(customerId) {
  const customer = db.getCustomer(customerId);
  if (!customer || !isTrialSimEnabledForCustomer(customer)) return;
  if (customer.trial_status !== 'active') return;

  const allocated = getTrialMinutesAllocated();
  const consumed = getTrialMinutesConsumed(db, customer);
  const pct = allocated > 0 ? consumed / allocated : 0;

  const name = customer.company_name || customer.name || 'there';
  const url = subscribeUrl();

  if (pct >= 0.5 && pct < 0.8) {
    sendTrialNudge(customer, 'usage_50', {
      smsBody: `DocLittle: You've used half your trial minutes (${consumed}/${allocated}). Subscribe to keep your line: ${url}`,
      emailSubject: 'Half your trial minutes used',
      emailText: `Hi ${name},\n\nYou've used ${consumed} of ${allocated} trial minutes.\n\nActivate your plan: ${url}\n\n— DocLittle`
    }).catch(() => {});
  }

  if (pct >= 0.8) {
    sendTrialNudge(customer, 'usage_80', {
      smsBody: `DocLittle: Trial almost out (${consumed}/${allocated} min). Your line may stop answering soon. Subscribe: ${url}`,
      emailSubject: 'Trial minutes almost gone',
      emailText: `Hi ${name},\n\nYou've used ${consumed} of ${allocated} trial minutes. Activate before your line pauses:\n${url}\n\n— DocLittle`
    }).catch(() => {});
  }
}

function maybeSendTrialLifecycleNudges(customerId, nudgeKey) {
  const customer = db.getCustomer(customerId);
  if (!customer) return Promise.resolve();

  const name = customer.company_name || customer.name || 'there';
  const url = subscribeUrl();
  const number = customer.twilio_phone_number || 'your number';

  if (nudgeKey === 'trial_expired') {
    return sendTrialNudge(customer, 'trial_expired', {
      smsBody: `DocLittle: Your trial line ${number} has been released. Subscribe to get a new dedicated number: ${url}`,
      emailSubject: 'Your trial line has expired',
      emailText: `Hi ${name},\n\nYour trial has ended and your number was released.\n\nSubscribe to restore service: ${url}\n\n— DocLittle`
    });
  }

  return Promise.resolve();
}

async function runScheduledTrialNudges() {
  const rows = db.prepare(`
    SELECT * FROM customers
    WHERE trial_status = 'active' AND trial_expires_at IS NOT NULL
  `).all();

  const now = Date.now();

  for (const customer of rows) {
    if (!isTrialSimEnabledForCustomer(customer)) continue;

    maybeSendTrialUsageNudges(customer.id);

    const expires = new Date(customer.trial_expires_at).getTime();
    const daysLeft = Math.ceil((expires - now) / (24 * 60 * 60 * 1000));
    const name = customer.company_name || customer.name || 'there';
    const url = subscribeUrl();
    const remaining = getTrialMinutesRemaining(db, customer);

    if (daysLeft === 2) {
      await sendTrialNudge(customer, 'day_5_warning', {
        smsBody: `DocLittle: 2 days left on your trial line (${remaining} min left). Keep your number: ${url}`,
        emailSubject: '2 days left on your trial',
        emailText: `Hi ${name},\n\nYour trial expires in 2 days. ${remaining} minutes remain.\n\nSubscribe: ${url}\n\n— DocLittle`
      });
    }

    if (daysLeft === 1) {
      await sendTrialNudge(customer, 'day_7_morning', {
        smsBody: `DocLittle: Your trial line expires tonight. Subscribe now to keep answering: ${url}`,
        emailSubject: 'Trial expires tonight',
        emailText: `Hi ${name},\n\nYour dedicated line expires tonight unless you subscribe.\n\n${url}\n\n— DocLittle`
      });
    }
  }
}

module.exports = {
  maybeSendTrialUsageNudges,
  maybeSendTrialLifecycleNudges,
  runScheduledTrialNudges,
  sendTrialNudge,
  isDodgecallSignup
};
