'use strict';

/**
 * Somo demo environment — canonical SOMO_DEMO_* with legacy DODGECALL_* fallback.
 */

function readEnv(primary, legacy) {
  const p = process.env[primary];
  if (p !== undefined && String(p).trim() !== '') return p;
  if (legacy) {
    const l = process.env[legacy];
    if (l !== undefined && String(l).trim() !== '') return l;
  }
  return undefined;
}

function readEnvString(primary, legacy, fallback = '') {
  const v = readEnv(primary, legacy);
  return v !== undefined ? String(v).trim() : fallback;
}

function readEnvInt(primary, legacy, fallback) {
  const raw = readEnv(primary, legacy);
  if (raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function readEnvBool(primary, legacy, defaultWhenUnset = true) {
  const v = readEnv(primary, legacy);
  if (v === undefined) return defaultWhenUnset;
  if (v === '0' || v === 'false') return false;
  return true;
}

function isDemoEnabled() {
  return readEnvBool('SOMO_DEMO_ENABLED', 'DODGECALL_DEMO_ENABLED', true);
}

function getDailyCap() {
  return readEnvInt('SOMO_DEMO_DAILY_CAP', 'DODGECALL_DEMO_DAILY_CAP', 100);
}

function getMaxConcurrent() {
  return readEnvInt('SOMO_DEMO_MAX_CONCURRENT', 'DODGECALL_DEMO_MAX_CONCURRENT', 3);
}

function getIpHourlyLimit() {
  return readEnvInt('SOMO_DEMO_IP_LIMIT_PER_HOUR', 'DODGECALL_DEMO_IP_LIMIT_PER_HOUR', 3);
}

function shouldRelaxDemoLimitsFlag() {
  const v = readEnv('SOMO_DEMO_RELAX_LIMITS', 'DODGECALL_DEMO_RELAX_LIMITS');
  return v === '1' || v === 'true';
}

function getTurnstileSecret() {
  return readEnvString('SOMO_DEMO_TURNSTILE_SECRET', 'DODGECALL_TURNSTILE_SECRET', '');
}

function getMaxDurationSec(fallback = 240) {
  return readEnvInt('SOMO_DEMO_MAX_DURATION_SEC', 'DODGECALL_DEMO_MAX_DURATION_SEC', fallback);
}

function getGroqModel(fallback = 'llama-3.3-70b-versatile') {
  return readEnvString('SOMO_DEMO_GROQ_MODEL', 'DODGECALL_DEMO_GROQ_MODEL', fallback);
}

function getSmsFromNumber() {
  return (
    readEnvString('SOMO_DEMO_SMS_FROM_NUMBER', 'DODGECALL_SMS_FROM_NUMBER', '') ||
    readEnvString('SOMO_DEMO_TWILIO_FROM_NUMBER', 'DODGECALL_TWILIO_FROM_NUMBER', '')
  );
}

function getTwilioFromNumber() {
  return readEnvString('SOMO_DEMO_TWILIO_FROM_NUMBER', 'DODGECALL_TWILIO_FROM_NUMBER', '');
}

function getRetellAgentId() {
  return readEnvString('SOMO_DEMO_RETELL_AGENT_ID', 'DODGECALL_RETELL_AGENT_ID', '');
}

function getDemoVoiceId() {
  return readEnvString('SOMO_DEMO_VOICE_ID', 'DODGECALL_DEMO_VOICE_ID', '');
}

function getSmokePlaceCall() {
  return readEnv('SOMO_DEMO_SMOKE_PLACE_CALL', 'DODGECALL_SMOKE_PLACE_CALL') === '1';
}

function getSmokePhone() {
  return readEnvString('SOMO_DEMO_SMOKE_PHONE', 'DODGECALL_SMOKE_PHONE', '');
}

/** Env key names for template registry (primary + legacy accepted by resolveEnv). */
const TEMPLATE_ENV = {
  RETELL_AGENT: ['SOMO_DEMO_RETELL_AGENT_ID', 'DODGECALL_RETELL_AGENT_ID'],
  TWILIO_FROM: ['SOMO_DEMO_TWILIO_FROM_NUMBER', 'DODGECALL_TWILIO_FROM_NUMBER'],
  VOICE_ID: ['SOMO_DEMO_VOICE_ID', 'DODGECALL_DEMO_VOICE_ID']
};

/** @type {Record<string, string>} primary SOMO_DEMO env key → legacy env key */
const LEGACY_ENV_BY_PRIMARY = {
  [TEMPLATE_ENV.RETELL_AGENT[0]]: TEMPLATE_ENV.RETELL_AGENT[1],
  [TEMPLATE_ENV.TWILIO_FROM[0]]: TEMPLATE_ENV.TWILIO_FROM[1],
  [TEMPLATE_ENV.VOICE_ID[0]]: TEMPLATE_ENV.VOICE_ID[1]
};

function getDemoFromNumberEnvKeys() {
  return [...TEMPLATE_ENV.TWILIO_FROM, 'TWILIO_PHONE_NUMBER'];
}

module.exports = {
  readEnv,
  readEnvString,
  readEnvInt,
  readEnvBool,
  isDemoEnabled,
  getDailyCap,
  getMaxConcurrent,
  getIpHourlyLimit,
  shouldRelaxDemoLimitsFlag,
  getTurnstileSecret,
  getMaxDurationSec,
  getGroqModel,
  getSmsFromNumber,
  getTwilioFromNumber,
  getRetellAgentId,
  getDemoVoiceId,
  getSmokePlaceCall,
  getSmokePhone,
  TEMPLATE_ENV,
  LEGACY_ENV_BY_PRIMARY,
  getDemoFromNumberEnvKeys
};
