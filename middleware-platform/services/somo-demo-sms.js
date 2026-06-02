'use strict';

const twilio = require('twilio');
const SMSService = require('./sms-service');
const somoDemoEnv = require('../lib/somo-demo-env');

function getFromNumber() {
  return (
    somoDemoEnv.getSmsFromNumber() ||
    process.env.TWILIO_PHONE_NUMBER ||
    null
  );
}

function getSignupUrl() {
  const base = process.env.SOMO_DEMO_SIGNUP_URL || '/signup?utm_source=somo-demo';
  if (base.startsWith('http')) return base;
  const apiBase = (process.env.API_BASE_URL || process.env.BASE_URL || '').replace(/\/+$/, '');
  if (apiBase) return `${apiBase}${base.startsWith('/') ? base : `/${base}`}`;
  return base;
}

/**
 * Send Somo demo signup link SMS (demo/marketing path — not patient SMS).
 */
async function sendSignupLink(phoneNumber, { prospectName } = {}) {
  const formatted = SMSService.formatPhoneNumber(phoneNumber);
  if (!formatted) throw new Error('Invalid phone for SMS');

  const url = getSignupUrl();
  const greeting = prospectName ? `Hi ${prospectName.split(' ')[0]},` : 'Hi,';
  const message = `${greeting} here is your Somo demo signup link: ${url} — Reply STOP to opt out.`;

  if (SMSService.isTestNumber(formatted)) {
    return {
      success: true,
      simulated: true,
      message,
      phone: formatted,
      provider: 'test'
    };
  }

  const from = getFromNumber();
  if (!from) {
    throw new Error(
      'Set SOMO_DEMO_SMS_FROM_NUMBER, SOMO_DEMO_TWILIO_FROM_NUMBER, or TWILIO_PHONE_NUMBER for signup SMS'
    );
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error('Twilio credentials required for signup SMS');
  }

  const client = twilio(sid, token);
  const result = await client.messages.create({
    body: message,
    from,
    to: formatted
  });

  return {
    success: true,
    message_sid: result.sid,
    status: result.status,
    phone: formatted,
    provider: 'twilio'
  };
}

module.exports = {
  getFromNumber,
  getSignupUrl,
  sendSignupLink
};
