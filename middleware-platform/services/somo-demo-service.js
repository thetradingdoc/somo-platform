'use strict';



const crypto = require('crypto');

const db = require('../database');

const { initiateSomoDemoDemoCall } = require('./outbound-call-service');

const { resolveTemplate } = require('./somo-demo-template-registry');

const { USE_CASES, USE_CASE_LABELS, USE_CASE_OPENERS, getUseCaseContext } = require('./somo-demo-use-cases');

const SMSService = require('./sms-service');



function isDemoEnabled() {

  const v = process.env.DODGECALL_DEMO_ENABLED;

  if (v === '0' || v === 'false') return false;

  return true;

}



function getDailyCap() {

  return parseInt(process.env.DODGECALL_DEMO_DAILY_CAP, 10) || 100;

}



function getMaxConcurrent() {

  return parseInt(process.env.DODGECALL_DEMO_MAX_CONCURRENT, 10) || 3;

}

function getIpHourlyLimit() {
  return parseInt(process.env.DODGECALL_DEMO_IP_LIMIT_PER_HOUR, 10) || 3;
}

function isLoopbackClientIp(clientIp) {
  const ip = String(clientIp || '')
    .trim()
    .replace(/^::ffff:/i, '');
  return !ip || ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

/** Local dev: skip IP/phone caps (failed Twilio attempts were counting toward the 3/hr IP limit). */
function shouldRelaxDemoLimits(clientIp) {
  if (process.env.DODGECALL_DEMO_RELAX_LIMITS === '1' || process.env.DODGECALL_DEMO_RELAX_LIMITS === 'true') {
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
    throw new Error('Demo calls are at capacity for today. Please try again tomorrow.');
  }

  const maxConcurrent = getMaxConcurrent();
  if (db.countActiveSomoDemoCalls() >= maxConcurrent) {
    throw new Error('Many demo calls are in progress. Please try again in a few minutes.');
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const ipLimit = getIpHourlyLimit();

  if (clientIp) {
    const ipCount = db.countSomoDemoRequestsSince({ client_ip: clientIp, since: hourAgo });
    if (ipCount >= ipLimit) {
      throw new Error('Too many demo requests from this network. Try again in an hour.');
    }
  }

  const phoneCount = db.countSomoDemoRequestsSince({
    phone,
    since: dayAgo,
    statuses: ['pending', 'initiated', 'ringing', 'answered', 'completed', 'in-progress']
  });
  if (phoneCount >= 1) {
    throw new Error('This number already received a demo call recently. Try again tomorrow.');
  }
}



async function requestDemoCall({ name, phone, use_case, consent, clientIp, attribution }) {

  if (!isDemoEnabled()) {

    throw new Error('Demo calls are temporarily unavailable');

  }



  if (consent !== true) {

    throw new Error('Consent is required to place a demo call');

  }



  const useCase = String(use_case || '').trim().toLowerCase();

  if (!USE_CASES.has(useCase)) {

    throw new Error('Invalid use case');

  }



  const template = resolveTemplate({ use_case: useCase });



  const prospectName = normalizeName(name);

  const normalizedPhone = normalizePhone(phone);

  checkRateLimits({ clientIp, phone: normalizedPhone });



  const id = crypto.randomUUID();

  db.insertSomoDemoRequest({

    id,

    name: prospectName,

    phone: normalizedPhone,

    use_case: useCase,

    template_id: template.template_id,

    client_ip: clientIp || null,

    attribution_json: attribution ? JSON.stringify(attribution) : null,

    status: 'pending'

  });



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



    return {

      success: true,

      demo_request_id: id,

      call_id: result.call_id

    };

  } catch (err) {

    db.updateSomoDemoRequest(id, { status: 'failed', error_message: err.message });

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

