'use strict';

const { isWithinBusinessHours, buildAfterHoursMessage, normalizeBusinessHours } = require('./voice-agent-runtime');

const BAD_PRACTICE_NAMES = new Set(['somo owner', 'owner', '']);

const OPERATOR_DISPLAY_NAME = 'Somo';

const OUTBOUND_CALL_TYPES = new Set([
  'sales_outbound',
  'operator_outbound',
  'rcm_follow_up',
  'outbound'
]);

function isOutboundCallType(callType) {
  return OUTBOUND_CALL_TYPES.has(String(callType || '').toLowerCase());
}

function sanitizePracticeName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed || BAD_PRACTICE_NAMES.has(trimmed.toLowerCase())) {
    return null;
  }
  return trimmed;
}

/**
 * @param {object} db
 * @param {{ customerId?: string, merchantId?: string, clinicId?: string, customer?: object }} opts
 */
function resolvePracticeDisplayName(db, opts = {}) {
  const customer = opts.customer || (opts.customerId && db.getCustomer ? db.getCustomer(opts.customerId) : null);
  if (customer?.customer_type === 'operator') {
    const named = sanitizePracticeName(customer.company_name) || sanitizePracticeName(customer.name);
    if (named) return named;
    return OPERATOR_DISPLAY_NAME;
  }
  let clinicId = opts.clinicId || null;
  let name = sanitizePracticeName(customer?.company_name || customer?.name);

  if (!name && customer?.merchant_id && db.db) {
    try {
      const clinic = db.db
        .prepare('SELECT name, clinic_id FROM clinics WHERE merchant_id = ? LIMIT 1')
        .get(customer.merchant_id);
      if (clinic) {
        clinicId = clinicId || clinic.clinic_id;
        name = sanitizePracticeName(clinic.name);
      }
    } catch (_) {}
  }

  if (!name && clinicId && db.getClinicById) {
    const clinic = db.getClinicById(clinicId);
    name = sanitizePracticeName(clinic?.name);
  }

  return name || 'our office';
}

function buildDefaultInboundGreeting(practiceName, tonePreset = 'warm') {
  const name = sanitizePracticeName(practiceName) || 'our office';
  if (tonePreset === 'concise') {
    return `Hi, I'm Kelly from ${name}. How can I help you today?`;
  }
  if (tonePreset === 'professional') {
    return `Hello, I'm Kelly, Somo's front desk receptionist for ${name}. How may I assist you today?`;
  }
  return `Hi, I'm Kelly, Somo's front desk receptionist. Thank you for calling ${name}. How can I help you today?`;
}

function buildDefaultOutboundOpener(practiceName, tonePreset = 'warm') {
  const name = sanitizePracticeName(practiceName) || 'our office';
  if (name === OPERATOR_DISPLAY_NAME || String(practiceName || '').toLowerCase() === 'somo') {
    if (tonePreset === 'concise') {
      return 'Hi, this is Kelly from Somo. Got a quick moment?';
    }
    return 'Hi, this is Kelly from Somo. Do you have a quick moment?';
  }
  if (tonePreset === 'concise') {
    return `Hi, this is Kelly from ${name}. Is now a good time?`;
  }
  return `Hi, I'm Kelly from ${name}. Is now still a good time to talk?`;
}

function parseJsonField(raw, fallback) {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

/**
 * @param {object} params
 * @param {object} [params.settings]
 * @param {object} [params.customer]
 * @param {string} [params.practiceName]
 * @param {string} [params.callType]
 * @param {string} [params.direction]
 * @param {Date} [params.now]
 */
function resolveCallOpeners(params = {}) {
  const {
    settings = {},
    customer = null,
    practiceName = null,
    callType = null,
    direction = null,
    now = new Date()
  } = params;

  const tone = settings.tone_preset || 'warm';
  const displayName =
    sanitizePracticeName(practiceName) ||
    sanitizePracticeName(customer?.company_name || customer?.name) ||
    (customer?.customer_type === 'operator' ? OPERATOR_DISPLAY_NAME : 'our office');

  const businessHours = normalizeBusinessHours(settings.business_hours);
  const withinHours = isWithinBusinessHours(businessHours, now);

  const inboundCustom = settings.greeting && String(settings.greeting).trim()
    ? String(settings.greeting).trim()
    : null;
  const outboundCustom = settings.outbound_opener && String(settings.outbound_opener).trim()
    ? String(settings.outbound_opener).trim()
    : null;

  const inboundDefault = buildDefaultInboundGreeting(displayName, tone);
  const outboundDefault = buildDefaultOutboundOpener(displayName, tone);
  const outboundEnabled = settings.outbound_enabled === 1 || settings.outbound_enabled === true;
  const callTypeNorm = String(callType || '').toLowerCase();
  // Operator/sales outbound scripts bypass tenant outbound_enabled toggle
  const systemOutboundCall =
    callTypeNorm === 'operator_outbound' ||
    callTypeNorm === 'sales_outbound' ||
    callTypeNorm === 'rcm_follow_up';
  const outboundSpeakAllowed = outboundEnabled || systemOutboundCall;

  const inbound = {
    text: inboundCustom || inboundDefault,
    source: inboundCustom ? 'tenant_setting' : 'default',
    withinHours,
    afterHoursMessage: !withinHours ? buildAfterHoursMessage(settings) : null
  };

  const outbound = {
    text: outboundSpeakAllowed ? (outboundCustom || outboundDefault) : null,
    source: outboundCustom ? 'tenant_setting' : 'default',
    enabled: outboundSpeakAllowed,
    disabledReason: outboundSpeakAllowed ? null : 'outbound_disabled'
  };

  const isOutbound =
    isOutboundCallType(callType) || String(direction || '').toLowerCase() === 'outbound';

  let activeOpener;
  if (isOutbound) {
    activeOpener = {
      direction: 'outbound',
      text: outbound.text,
      source: outbound.source,
      enabled: outbound.enabled
    };
  } else if (!withinHours && inbound.afterHoursMessage) {
    activeOpener = {
      direction: 'inbound',
      text: inbound.afterHoursMessage,
      source: 'after_hours',
      enabled: true
    };
  } else {
    activeOpener = {
      direction: 'inbound',
      text: inbound.text,
      source: inbound.source,
      enabled: true
    };
  }

  return { inbound, outbound, activeOpener, practiceName: displayName };
}

function isLegacyGenericGreeting(greeting) {
  const g = String(greeting || '').toLowerCase();
  return g.includes("you've reached") || g.includes('your ai front desk');
}

module.exports = {
  BAD_PRACTICE_NAMES,
  OPERATOR_DISPLAY_NAME,
  isOutboundCallType,
  sanitizePracticeName,
  resolvePracticeDisplayName,
  buildDefaultInboundGreeting,
  buildDefaultOutboundOpener,
  resolveCallOpeners,
  isLegacyGenericGreeting,
  parseJsonField
};
