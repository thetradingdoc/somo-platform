'use strict';

const axios = require('axios');
const SMSService = require('../platform/sms-service');

function isConfigured() {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_VERIFY_SERVICE_SID
  );
}

/** Local/staging: skip Verify API; accept OTP 000000 on check (server must set this in .env). */
function isDevMock() {
  const v = process.env.TWILIO_VERIFY_DEV_MOCK;
  return (
    process.env.NODE_ENV !== 'production' &&
    (v === '1' || v === 'true')
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
  const to = normalizePhone(phoneE164);

  if (isDevMock()) {
    console.warn('[TwilioVerify] TWILIO_VERIFY_DEV_MOCK — skipping SMS send');
    return { success: true, mock: true, to };
  }

  if (!isConfigured()) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[TwilioVerify] Not configured — dev mock send');
      return { success: true, mock: true, to };
    }
    throw new Error('Phone verification is not configured');
  }

  let response;
  try {
    response = await axios.post(
      `${verifyApiBase()}/Verifications`,
      new URLSearchParams({ To: to, Channel: 'sms' }).toString(),
      {
        auth: auth(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000
      }
    );
  } catch (err) {
    const status = err.response?.status;
    const hint =
      status === 404
        ? ' Twilio Verify returned 404 — check TWILIO_VERIFY_SERVICE_SID in the Twilio console, or set TWILIO_VERIFY_DEV_MOCK=1 in .env and restart the server.'
        : '';
    throw new Error(`${err.message || 'Verify send failed'}${hint}`);
  }

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

  if (isDevMock() && trimmedCode === '000000') {
    return { approved: true, mock: true, to };
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

  let response;
  try {
    response = await axios.post(
      `${verifyApiBase()}/VerificationCheck`,
      new URLSearchParams({ To: to, Code: trimmedCode }).toString(),
      {
        auth: auth(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000
      }
    );
  } catch (err) {
    const status = err.response?.status;
    const hint =
      status === 404
        ? ' Twilio Verify returned 404 — check TWILIO_VERIFY_SERVICE_SID or use TWILIO_VERIFY_DEV_MOCK=1 with code 000000.'
        : '';
    throw new Error(`${err.message || 'Verify check failed'}${hint}`);
  }

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
