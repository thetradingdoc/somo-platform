'use strict';

const axios = require('axios');
const SMSService = require('./sms-service');

function isConfigured() {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_VERIFY_SERVICE_SID
  );
}

function normalizePhone(phone) {
  const formatted = SMSService.formatPhoneNumber(phone);
  if (!formatted || !/^\+[1-9]\d{9,14}$/.test(formatted)) {
    throw new Error('Invalid phone number. Use E.164 format, e.g. +15551234567');
  }
  return formatted;
}

function verifyApiBase() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  return `https://verify.twilio.com/v2/Services/${process.env.TWILIO_VERIFY_SERVICE_SID}`;
}

function auth() {
  return {
    username: process.env.TWILIO_ACCOUNT_SID,
    password: process.env.TWILIO_AUTH_TOKEN
  };
}

/**
 * Send SMS verification code via Twilio Verify v2.
 */
async function sendPhoneVerification(phoneE164) {
  if (!isConfigured()) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[TwilioVerify] Not configured — dev mock send');
      return { success: true, mock: true, to: phoneE164 };
    }
    throw new Error('Phone verification is not configured');
  }

  const to = normalizePhone(phoneE164);
  const response = await axios.post(
    `${verifyApiBase()}/Verifications`,
    new URLSearchParams({ To: to, Channel: 'sms' }).toString(),
    {
      auth: auth(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000
    }
  );

  return {
    success: true,
    status: response.data?.status,
    to
  };
}

/**
 * Check verification code. Returns { approved, to, carrier? }.
 */
async function checkPhoneVerification(phoneE164, code) {
  const to = normalizePhone(phoneE164);
  const trimmedCode = String(code || '').trim();
  if (!/^\d{4,8}$/.test(trimmedCode)) {
    throw new Error('Invalid verification code');
  }

  if (!isConfigured()) {
    if (process.env.NODE_ENV !== 'production' && trimmedCode === '000000') {
      return { approved: true, mock: true, to };
    }
    if (process.env.NODE_ENV !== 'production') {
      throw new Error('Twilio Verify not configured. Use code 000000 in dev or set TWILIO_VERIFY_SERVICE_SID');
    }
    throw new Error('Phone verification is not configured');
  }

  const response = await axios.post(
    `${verifyApiBase()}/VerificationCheck`,
    new URLSearchParams({ To: to, Code: trimmedCode }).toString(),
    {
      auth: auth(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000
    }
  );

  const approved = response.data?.status === 'approved';
  return {
    approved,
    status: response.data?.status,
    to
  };
}

module.exports = {
  isConfigured,
  normalizePhone,
  sendPhoneVerification,
  checkPhoneVerification
};
