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

function isOperatorPracticeName(practiceName, sanitized) {
  return (
    sanitized === OPERATOR_DISPLAY_NAME ||
    String(practiceName || '').toLowerCase() === 'somo'
  );
}

function buildAiDisclosureLine(locale = 'en') {
  const loc = String(locale || 'en').slice(0, 2);
  if (loc === 'es') {
    return 'Esta llamada puede ser grabada y atendida por un asistente automatizado.';
  }
  if (loc === 'ru') {
    return 'Этот звонок может записываться и обрабатываться автоматическим помощником.';
  }
  return 'This call may be recorded and answered by an automated assistant.';
}

function prependAiDisclosure(text, { enabled = true, locale = 'en' } = {}) {
  if (!enabled) return String(text || '').trim();
  const loc = String(locale || 'en').slice(0, 2);
  let body = String(text || '').trim();
  const line = buildAiDisclosureLine(loc);
  body = body
    .replace(/^This call may be recorded[^.]*\.\s*/i, '')
    .replace(/^Esta llamada puede ser grabada[^.]*\.\s*/i, '')
    .replace(/^Этот звонок может записываться[^.]*\.\s*/iu, '')
    .trim();
  if (!body) return line;
  if (
    loc === 'en' &&
    (body.toLowerCase().includes('automated assistant') || body.toLowerCase().includes('may be recorded'))
  ) {
    return body;
  }
  return `${line} ${body}`;
}

function resolveGreetingWithDisclosure(settings, customer, opts = {}) {
  let base;
  if (settings?.greeting && String(settings.greeting).trim()) {
    base = String(settings.greeting).trim();
  } else {
    const company = customer?.company_name || customer?.name || 'our office';
    base = buildDefaultInboundGreeting(company, settings?.tone_preset || 'warm');
  }
  const enabled =
    opts.aiDisclosureEnabled !== false &&
    settings?.ai_disclosure_enabled !== 0 &&
    settings?.ai_disclosure_enabled !== false;
  return prependAiDisclosure(base, { enabled, locale: opts.locale || 'en' });
}

function buildDefaultInboundGreeting(practiceName, tonePreset = 'warm') {
  const name = sanitizePracticeName(practiceName) || 'our office';
  const isOperator = isOperatorPracticeName(practiceName, name);
  // Per-tenant branding: only the operator (Somo) calls itself "Somo's front desk receptionist".
  const role = isOperator
    ? "Hi, I'm Kelly, Somo's front desk receptionist"
    : `Hi, I'm Kelly, the front desk at ${name}`;
  const thanks = isOperator ? 'Thank you for calling Somo.' : 'Thank you for calling.';

  // Name-first intake: every default opener asks for the caller's name before intent.
  if (tonePreset === 'concise') {
    return `${role}. Can I get your name?`;
  }
  if (tonePreset === 'professional') {
    return `${role}. ${thanks} May I please start with your name?`;
  }
  if (tonePreset === 'warm_confident') {
    return `${role}. ${thanks} I'd love to help — to start, may I have your name?`;
  }
  return `${role}. ${thanks} Can I start with your name?`;
}

function buildDefaultOutboundOpener(practiceName, tonePreset = 'warm') {
  const name = sanitizePracticeName(practiceName) || 'our office';
  if (isOperatorPracticeName(practiceName, name)) {
    if (tonePreset === 'concise') {
      return 'Hi, this is Kelly from Somo. Got a quick moment?';
    }
    if (tonePreset === 'warm_confident') {
      return 'Hi, this is Kelly with Somo. I know your time is valuable — do you have a quick moment?';
    }
    return 'Hi, this is Kelly from Somo. Do you have a quick moment?';
  }
  if (tonePreset === 'concise') {
    return `Hi, this is Kelly from ${name}. Is now a good time?`;
  }
  if (tonePreset === 'warm_confident') {
    return `Hi, this is Kelly with ${name}. I know your time is valuable — is now a good time to talk?`;
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
    locale = null,
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

  const inboundSource = inboundCustom ? 'tenant_setting' : 'default';
  let inboundText = inboundCustom || inboundDefault;
  const disclosureOn =
    settings?.ai_disclosure_enabled !== 0 && settings?.ai_disclosure_enabled !== false;
  if (inboundSource === 'default' && withinHours && disclosureOn) {
    inboundText = prependAiDisclosure(inboundText, {
      enabled: true,
      locale: locale || settings.default_locale || customer?.default_locale || 'en'
    });
  }
  // Name-first only applies when the opener actually asks for the caller's name.
  // Our defaults always do; a custom tenant greeting only counts if it asks.
  const inboundAsksName =
    withinHours && (inboundSource === 'default' || greetingAsksForName(inboundText));
  const inbound = {
    text: inboundText,
    source: inboundSource,
    withinHours,
    asksName: inboundAsksName,
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
      enabled: outbound.enabled,
      asksName: false
    };
  } else if (!withinHours && inbound.afterHoursMessage) {
    activeOpener = {
      direction: 'inbound',
      text: inbound.afterHoursMessage,
      source: 'after_hours',
      enabled: true,
      asksName: false
    };
  } else {
    activeOpener = {
      direction: 'inbound',
      text: inbound.text,
      source: inbound.source,
      enabled: true,
      asksName: inbound.asksName
    };
  }

  return { inbound, outbound, activeOpener, practiceName: displayName };
}

function isLegacyGenericGreeting(greeting) {
  const g = String(greeting || '').toLowerCase();
  return g.includes("you've reached") || g.includes('your ai front desk');
}

/**
 * True when a greeting explicitly asks the caller for their name, so downstream
 * channels know whether to expect a name as the first reply (name-first intake).
 * @param {string} greeting
 */
function greetingAsksForName(greeting) {
  const g = String(greeting || '').toLowerCase();
  return /\byour name\b/.test(g) || /\bget your name\b/.test(g) || /\bhave your name\b/.test(g);
}

/**
 * Lightweight person-name sanitizer for greeting personalization (NOT identity).
 * Returns a trimmed, length-capped first token, or null if it doesn't look usable.
 * @param {string} name
 */
function sanitizePersonName(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  // Use the first token (first name) for a natural greeting.
  const first = raw.split(/\s+/)[0].replace(/[^\p{L}'-]/gu, '');
  if (first.length < 2 || first.length > 40) return null;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/**
 * Channel-agnostic first-contact greeting used by both voice and chat.
 * - Known caller name: greet by name and do NOT ask for it (asksName=false).
 * - Unknown caller within hours: branded, name-first opener (asksName=true).
 * - After hours: after-hours message (asksName=false).
 *
 * @param {object} params
 * @param {string} [params.channel] 'voice' | 'chat'
 * @param {object} [params.settings] voice_agent_settings row
 * @param {object} [params.customer]
 * @param {string} [params.practiceName]
 * @param {string} [params.knownName] caller's name if already known (skip name-first)
 * @param {string} [params.callType]
 * @param {string} [params.direction]
 * @param {Date} [params.now]
 * @returns {{ text: string, asksName: boolean, source: string, afterHours: boolean, practiceName: string }}
 */
function resolveFirstContactGreeting(params = {}) {
  const { knownName = null, channel = 'voice', ...rest } = params;
  const bundle = resolveCallOpeners({
    ...rest,
    direction: rest.direction || 'inbound'
  });
  const active = bundle.activeOpener;
  // Soften voice-only phrasing for text chat.
  const adaptForChannel = (text) =>
    channel === 'chat'
      ? String(text || '').replace(/thank you for calling\.?/i, 'Thanks for reaching out.')
      : text;
  const displayName = bundle.practiceName;
  const brandLabel =
    displayName === OPERATOR_DISPLAY_NAME
      ? 'Somo'
      : displayName && displayName !== 'our office'
        ? displayName
        : 'the front desk';

  const cleanName = sanitizePersonName(knownName);
  if (cleanName && active.direction === 'inbound' && active.source !== 'after_hours') {
    return {
      text: `Hi ${cleanName}, this is Kelly at ${brandLabel}. How can I help you today?`,
      asksName: false,
      source: 'known_name',
      afterHours: false,
      practiceName: displayName
    };
  }

  return {
    text: adaptForChannel(active.text),
    asksName: active.asksName === true,
    source: active.source,
    afterHours: active.source === 'after_hours',
    practiceName: displayName
  };
}

/**
 * Detects greetings that look like a previously auto-generated default (intent-first,
 * pre name-first rollout). Safe to regenerate; hand-written custom greetings are left alone.
 * @param {string} greeting
 */
function isManagedDefaultGreeting(greeting) {
  const g = String(greeting || '').trim();
  if (!g) return false;
  return (
    /how can i help you today\??\s*$/i.test(g) &&
    (/front desk/i.test(g) || /thank you for calling/i.test(g))
  );
}

module.exports = {
  BAD_PRACTICE_NAMES,
  OPERATOR_DISPLAY_NAME,
  isOutboundCallType,
  sanitizePracticeName,
  resolvePracticeDisplayName,
  buildDefaultInboundGreeting,
  buildDefaultOutboundOpener,
  buildAiDisclosureLine,
  prependAiDisclosure,
  resolveGreetingWithDisclosure,
  resolveCallOpeners,
  resolveFirstContactGreeting,
  sanitizePersonName,
  isLegacyGenericGreeting,
  isManagedDefaultGreeting,
  greetingAsksForName,
  parseJsonField
};
