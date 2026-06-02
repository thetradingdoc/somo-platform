'use strict';

const path = require('path');
const fs = require('fs');
const { getUseCaseContext } = require('./somo-demo-use-cases');

const AGENT_ENV_FALLBACKS = ['RETELL_SALES_AGENT_ID', 'RETELL_AGENT_ID'];
const FROM_ENV_FALLBACKS = ['TWILIO_PHONE_NUMBER'];
const VOICE_ENV_FALLBACKS = ['RETELL_VOICE_ID'];

let _config = null;

function loadConfig() {
  if (_config) return _config;
  const configPath = path.join(__dirname, '..', 'config', 'somo-demo-templates.json');
  _config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  return _config;
}

/**
 * Read first non-empty env among primary + fallbacks.
 */
function resolveEnv(primaryKey, fallbackKeys = []) {
  const keys = [primaryKey, ...fallbackKeys];
  for (const key of keys) {
    const val = process.env[key];
    if (val && String(val).trim()) {
      return String(val).trim();
    }
  }
  throw new Error(
    `Somo demo demo misconfigured: set one of ${keys.join(', ')} in middleware-platform/.env`
  );
}

function resolveOptionalEnv(primaryKey, fallbackKeys = []) {
  const keys = [primaryKey, ...fallbackKeys];
  for (const key of keys) {
    const val = process.env[key];
    if (val && String(val).trim()) {
      return String(val).trim();
    }
  }
  return null;
}

/**
 * Resolve telephony + persona for a landing use_case.
 * @param {{ use_case: string }} params
 */
function resolveTemplate({ use_case }) {
  const config = loadConfig();
  const useCase = String(use_case || 'receptionist').trim().toLowerCase();
  const templateId = config.use_case_map[useCase] || config.use_case_map.receptionist || 'medical';
  const template = config.templates[templateId];
  if (!template) {
    throw new Error(`Unknown Somo demo template: ${templateId}`);
  }

  const agentId = resolveEnv(template.retell_agent_id_env, AGENT_ENV_FALLBACKS);
  const fromNumber = resolveEnv(template.twilio_from_env, FROM_ENV_FALLBACKS);
  const voiceId = resolveOptionalEnv(template.voice_id_env, VOICE_ENV_FALLBACKS);

  const maxDurationSec =
    parseInt(process.env.DODGECALL_DEMO_MAX_DURATION_SEC, 10) ||
    template.max_duration_sec ||
    240;

  const ctx = getUseCaseContext(useCase);

  return {
    template_id: templateId,
    use_case: useCase,
    agentId,
    fromNumber,
    voiceId,
    personaName: template.persona_name || 'Sam',
    maxDurationSec,
    use_case_label: ctx.use_case_label,
    use_case_opener: ctx.use_case_opener
  };
}

function getDemoFromNumberCandidates() {
  const keys = [
    'DODGECALL_TWILIO_FROM_NUMBER',
    'TWILIO_PHONE_NUMBER'
  ];
  return keys
    .map((k) => process.env[k])
    .filter((v) => v && String(v).trim())
    .map((v) => String(v).trim());
}

function isDemoTwilioNumber(normalizedTo) {
  if (!normalizedTo) return false;
  const SMSService = require('./sms-service');
  const target = SMSService.formatPhoneNumber(normalizedTo);
  try {
    const { fromNumber } = resolveTemplate({ use_case: 'receptionist' });
    return SMSService.formatPhoneNumber(fromNumber) === target;
  } catch {
    for (const from of getDemoFromNumberCandidates()) {
      if (SMSService.formatPhoneNumber(from) === target) return true;
    }
    return false;
  }
}

module.exports = {
  loadConfig,
  resolveEnv,
  resolveOptionalEnv,
  resolveTemplate,
  isDemoTwilioNumber,
  AGENT_ENV_FALLBACKS,
  FROM_ENV_FALLBACKS
};
