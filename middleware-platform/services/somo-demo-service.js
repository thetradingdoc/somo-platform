'use strict';



const crypto = require('crypto');

const db = require('../database');

const { initiateSomoDemoDemoCall } = require('./outbound-call-service');

const { resolveTemplate } = require('./somo-demo-template-registry');

const { USE_CASES, USE_CASE_LABELS, USE_CASE_OPENERS, getUseCaseContext } = require('./somo-demo-use-cases');

const SMSService = require('./sms-service');
const { appendEventLog, upsertLeadStatus } = require('./somo-demo-sheets-sync');
const somoDemoEnv = require('../lib/somo-demo-env');

function buildDemoError(message, code, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}



const isDemoEnabled = somoDemoEnv.isDemoEnabled;
const getDailyCap = somoDemoEnv.getDailyCap;
const getMaxConcurrent = somoDemoEnv.getMaxConcurrent;
const getIpHourlyLimit = somoDemoEnv.getIpHourlyLimit;

function isLoopbackClientIp(clientIp) {
  const ip = String(clientIp || '')
    .trim()
    .replace(/^::ffff:/i, '');
  return !ip || ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

/** Local dev: skip IP/phone caps (failed Twilio attempts were counting toward the 3/hr IP limit). */
function shouldRelaxDemoLimits(clientIp) {
  if (somoDemoEnv.shouldRelaxDemoLimitsFlag()) {
    return true;
  }
  if (process.env.NODE_ENV === 'production') return false;
  return isLoopbackClientIp(clientIp);
}

function normalizeName(name) {

  const trimmed = String(name || '').trim();

  if (trimmed.length < 2 || trimmed.length > 80) {

    throw new Error('Name must be between 2 and 80 characters');

  }

  return trimmed;

}



function normalizePhone(phone) {

  const formatted = SMSService.formatPhoneNumber(phone);

  if (!formatted || !/^\+[1-9]\d{9,14}$/.test(formatted)) {

    throw new Error('Invalid phone number. Use E.164 format, e.g. +15551234567');

  }

  return formatted;

}



function checkRateLimits({ clientIp, phone }) {
  if (shouldRelaxDemoLimits(clientIp)) {
    return;
  }

  const dailyCap = getDailyCap();
  if (db.countSomoDemoRequestsToday() >= dailyCap) {
    throw buildDemoError(
      'Demo calls are at capacity for today. Please try again tomorrow.',
      'DAILY_CAP_REACHED',
      429
    );
  }

  const maxConcurrent = getMaxConcurrent();
  if (db.countActiveSomoDemoCalls() >= maxConcurrent) {
    throw buildDemoError(
      'Many demo calls are in progress. Please try again in a few minutes.',
      'CONCURRENT_CAP_REACHED',
      429
    );
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const ipLimit = getIpHourlyLimit();

  if (clientIp) {
    const ipCount = db.countSomoDemoRequestsSince({ client_ip: clientIp, since: hourAgo });
    if (ipCount >= ipLimit) {
      throw buildDemoError(
        'Too many demo requests from this network. Try again in an hour.',
        'IP_RATE_LIMIT',
        429
      );
    }
  }

  const phoneCount = db.countSomoDemoRequestsSince({
    phone,
    since: dayAgo,
    statuses: ['pending', 'initiated', 'ringing', 'answered', 'completed', 'in-progress']
  });
  if (phoneCount >= 1) {
    throw buildDemoError(
      'This number already received a demo call recently. Try again tomorrow.',
      'DUPLICATE_PHONE_WINDOW',
      429
    );
  }
}



async function requestDemoCall({
  name,
  phone,
  use_case,
  language,
  country,
  city,
  practice_specialty,
  practice_size,
  questions_asked,
  consent,
  clientIp,
  attribution
}) {

  if (!isDemoEnabled()) {

    throw buildDemoError('Demo calls are temporarily unavailable', 'DEMO_DISABLED', 503);

  }



  if (consent !== true) {

    throw buildDemoError('Consent is required to place a demo call', 'CONSENT_REQUIRED', 400);

  }



  let useCase = String(use_case || '').trim().toLowerCase();
  if (!useCase) useCase = 'medical_clinic';

  if (!USE_CASES.has(useCase)) {

    throw buildDemoError('Invalid use case', 'INVALID_USE_CASE', 400);

  }



  const template = resolveTemplate({ use_case: useCase });



  const prospectName = normalizeName(name);

  const normalizedPhone = normalizePhone(phone);

  checkRateLimits({ clientIp, phone: normalizedPhone });



  const id = crypto.randomUUID();
  const lockAcquired = db.acquireSomoDemoDailyPhoneLock(normalizedPhone, id);
  if (!lockAcquired) {
    throw buildDemoError(
      'This number already received a demo call recently. Try again tomorrow.',
      'DUPLICATE_PHONE_WINDOW',
      429
    );
  }

  try {
    db.insertSomoDemoRequest({

      id,

      name: prospectName,

      phone: normalizedPhone,

      use_case: useCase,

      template_id: template.template_id,
      language: language || null,
      country: country || null,
      city: city || null,
      practice_specialty: practice_specialty || null,
      practice_size: practice_size || null,
      questions_asked: questions_asked || null,

      client_ip: clientIp || null,

      attribution_json: attribution ? JSON.stringify(attribution) : null,

      status: 'pending'

    });
    await appendEventLog({
      event_type: 'request_received',
      demo_request_id: id,
      phone: normalizedPhone,
      status: 'pending',
      language,
      country,
      city,
      practice_specialty,
      practice_size,
      questions_asked,
      metadata_json: { use_case: useCase, client_ip: clientIp || null }
    }).catch(() => null);
    await upsertLeadStatus({
      demo_request_id: id,
      phone: normalizedPhone,
      name: prospectName,
      language,
      country,
      city,
      practice_specialty,
      practice_size,
      questions_asked,
      status: 'pending'
    }).catch(() => null);
  } catch (err) {
    db.releaseSomoDemoDailyPhoneLock(normalizedPhone);
    throw err;
  }



  try {

    const result = await initiateSomoDemoDemoCall({

      phone_number: normalizedPhone,

      demo_request_id: id,

      use_case: useCase,

      prospect_name: prospectName,

      template

    });



    db.updateSomoDemoRequest(id, {

      status: 'initiated',

      twilio_call_sid: result.call_id

    });
    await appendEventLog({
      event_type: 'call_initiated',
      demo_request_id: id,
      phone: normalizedPhone,
      call_id: result.call_id,
      status: 'initiated',
      language,
      country,
      city,
      practice_specialty,
      practice_size,
      questions_asked,
      metadata_json: { use_case: useCase }
    }).catch(() => null);
    await upsertLeadStatus({
      demo_request_id: id,
      phone: normalizedPhone,
      name: prospectName,
      language,
      country,
      city,
      practice_specialty,
      practice_size,
      questions_asked,
      status: 'initiated',
      call_start_at: new Date().toISOString()
    }).catch(() => null);



    return {

      success: true,

      demo_request_id: id,

      call_id: result.call_id

    };

  } catch (err) {

    db.updateSomoDemoRequest(id, { status: 'failed', error_message: err.message });
    db.releaseSomoDemoDailyPhoneLock(normalizedPhone);
    await appendEventLog({
      event_type: 'request_failed',
      demo_request_id: id,
      phone: normalizedPhone,
      status: 'failed',
      language,
      country,
      city,
      practice_specialty,
      practice_size,
      questions_asked,
      error_code: err.code || '',
      error_message: err.message || ''
    }).catch(() => null);
    await upsertLeadStatus({
      demo_request_id: id,
      phone: normalizedPhone,
      name: prospectName,
      language,
      country,
      city,
      practice_specialty,
      practice_size,
      questions_asked,
      status: 'failed'
    }).catch(() => null);

    throw err;

  }

}



module.exports = {

  USE_CASES,

  USE_CASE_LABELS,

  USE_CASE_OPENERS,

  requestDemoCall,

  getUseCaseContext,

  isDemoEnabled,

  getDailyCap,

  getMaxConcurrent

};

