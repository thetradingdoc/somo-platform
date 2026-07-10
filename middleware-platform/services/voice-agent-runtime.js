'use strict';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseTimeToMinutes(hhmm) {
  const m = String(hhmm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function parseHoursEntry(val) {
  if (!val || typeof val !== 'string') return null;
  const parts = val.split('-').map((s) => s.trim());
  if (parts.length !== 2) return null;
  const start = parseTimeToMinutes(parts[0]);
  const end = parseTimeToMinutes(parts[1]);
  if (start == null || end == null) return null;
  return { start, end };
}

function normalizeBusinessHours(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }
  return typeof raw === 'object' ? raw : null;
}

/**
 * @param {object|null} businessHours
 * @param {Date} [now]
 * @returns {boolean} true if within hours or no hours configured
 */
function isWithinBusinessHours(businessHours, now = new Date()) {
  const hours = normalizeBusinessHours(businessHours);
  if (!hours || Object.keys(hours).length === 0) return true;

  const dayKey = DAY_KEYS[now.getDay()];
  const entry = hours[dayKey];
  if (!entry) return false;

  const range = parseHoursEntry(entry);
  if (!range) return true;

  const mins = now.getHours() * 60 + now.getMinutes();
  if (range.end > range.start) {
    return mins >= range.start && mins < range.end;
  }
  return mins >= range.start || mins < range.end;
}

function buildUnavailableMessage() {
  return (
    process.env.VOICE_AGENT_UNAVAILABLE_MESSAGE ||
    'This office is not accepting calls right now. Please try again during business hours.'
  );
}

function buildAfterHoursMessage(settings) {
  if (settings?.after_hours_message && String(settings.after_hours_message).trim()) {
    return String(settings.after_hours_message).trim();
  }
  return (
    process.env.VOICE_AGENT_AFTER_HOURS_MESSAGE ||
    'Thank you for calling. We are currently closed. Please call back during our office hours.'
  );
}

function parseJsonHours(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function resolveTransferNumber(db, clinicId, customer) {
  if (clinicId && db?.getClinicById) {
    const clinic = db.getClinicById(clinicId);
    const fromClinic =
      clinic?.transfer_number || clinic?.fallback_pstn || clinic?.phone_number || null;
    if (fromClinic) return String(fromClinic).trim();
  }
  if (customer?.phone_number) return String(customer.phone_number).trim();
  return null;
}

function resolveOverflowNumber(db, clinicId, customer, settings) {
  if (settings?.overflow_enabled === 0 || settings?.overflow_enabled === false) {
    return null;
  }
  if (clinicId && db?.getClinicById) {
    const clinic = db.getClinicById(clinicId);
    if (clinic?.overflow_phone) return String(clinic.overflow_phone).trim();
  }
  return resolveTransferNumber(db, clinicId, customer);
}

function resolveForwardAction(transferNumber) {
  return transferNumber ? 'forward_pstn' : 'hangup';
}

function buildDefaultGreeting(companyName) {
  const { buildDefaultInboundGreeting } = require('./call-opener-resolver');
  return buildDefaultInboundGreeting(companyName, 'warm');
}

function resolveGreeting(settings, customer) {
  if (settings?.greeting && String(settings.greeting).trim()) {
    return String(settings.greeting).trim();
  }
  const company =
    customer?.company_name || customer?.name || 'our office';
  return buildDefaultGreeting(company);
}

/**
 * Display label for recent calls (name, phone, or fallback).
 * @param {{ customerName?: string, customerPhone?: string, callMetadata?: object }} connection
 */
function formatCallerLabel(connection) {
  const name = connection?.customerName || connection?.initialName || null;
  if (name && String(name).trim()) {
    return String(name).trim();
  }
  const phone =
    connection?.customerPhone ||
    connection?.callMetadata?.from_number ||
    null;
  if (phone) {
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    if (digits.length === 11 && digits[0] === '1') {
      return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    return String(phone).trim();
  }
  return 'Unknown caller';
}

function formatCallerLabelFromCallRow(call) {
  if (call?.caller_label && String(call.caller_label).trim()) {
    return String(call.caller_label).trim();
  }
  const phone = call?.caller_phone || null;
  if (phone) {
    return formatCallerLabel({ customerPhone: phone });
  }
  return 'Unknown caller';
}

/**
 * @param {object} db
 * @param {object} callMeta Retell call_details payload
 */
function resolveTenantFromCallMeta(db, callMeta) {
  const dv =
    callMeta?.dynamic_variables ||
    callMeta?.retell_llm_dynamic_variables ||
    callMeta?.metadata?.dynamic_variables ||
    {};
  const meta = callMeta?.metadata || {};

  let customerId =
    dv.customer_id || meta.customer_id || null;
  let merchantId = dv.merchant_id || meta.merchant_id || null;
  let clinicId = dv.clinic_id || meta.clinic_id || null;

  const toNumber = callMeta?.to_number || meta?.to_number || null;
  if (!customerId && toNumber && db.getCustomerByPhone) {
    const byPhone = db.getCustomerByPhone(toNumber);
    if (byPhone) {
      customerId = byPhone.id;
      if (!merchantId) merchantId = byPhone.merchant_id || null;
    }
  }

  let customer = null;
  if (customerId && db.getCustomer) {
    customer = db.getCustomer(customerId);
    if (customer) {
      if (!merchantId) merchantId = customer.merchant_id || null;
    }
  }

  if (!clinicId && customer?.merchant_id && db.db) {
    try {
      const { resolveTenantClinicFromCallMeta } = require('./voice-call-context');
      const resolved = resolveTenantClinicFromCallMeta(db, {
        to_number: toNumber,
        clinic_id: meta.clinic_id,
        site_context_status: meta.site_context_status || dv.site_context_status
      });
      if (resolved?.site_context_status === 'verified' && resolved.clinic_id) {
        clinicId = resolved.clinic_id;
      }
    } catch (_) {}
  }

  if (!customerId && callMeta?.agent_id && db.db) {
    const c = db.db
      .prepare('SELECT * FROM customers WHERE retell_agent_id = ? LIMIT 1')
      .get(callMeta.agent_id);
    if (c) {
      customer = c;
      customerId = c.id;
      merchantId = merchantId || c.merchant_id || null;
    }
  }

  return { customerId, merchantId, clinicId, customer };
}

/**
 * @param {object} db
 * @param {{ merchantId?: string, customerId?: string }} ids
 */
function loadProviderVoiceRuntime(db, ids = {}) {
  let { merchantId, customerId, clinicId } = ids;
  let customer = null;

  if (customerId && db.getCustomer) {
    customer = db.getCustomer(customerId);
    if (customer && !merchantId) merchantId = customer.merchant_id || null;
  }

  let settings = null;
  if (db.getVoiceAgentSettingsForProvider) {
    settings = db.getVoiceAgentSettingsForProvider({ merchantId, customerId, clinicId });
    if (settings?.business_hours && typeof settings.business_hours === 'string') {
      settings.business_hours = parseJsonHours(settings.business_hours);
    }
    if (settings?.coverage_hours && typeof settings.coverage_hours === 'string') {
      settings.coverage_hours = parseJsonHours(settings.coverage_hours);
    }
  }

  const transferNumber = resolveTransferNumber(db, clinicId, customer);
  const overflowNumber = resolveOverflowNumber(db, clinicId, customer, settings);
  const coverageMode = String(settings?.coverage_mode || 'full_replacement').toLowerCase();
  const afterHoursAction = String(settings?.after_hours_action || 'message_only').toLowerCase();
  const aiDisclosureEnabled =
    settings?.ai_disclosure_enabled !== 0 && settings?.ai_disclosure_enabled !== false;
  const voiceReplySuppressEnabled =
    settings?.voice_reply_suppress_enabled === 1 || settings?.voice_reply_suppress_enabled === true;

  const kellyStatus = String(
    customer?.kelly_status || customer?.retell_agent_status || 'active'
  ).toLowerCase();
  const settingsEnabled = settings?.enabled !== 0 && settings?.enabled !== false;
  const kellyPaused = kellyStatus === 'paused';
  const agentEnabled = !kellyPaused && settingsEnabled;

  const { resolveGreetingWithDisclosure } = require('./call-opener-resolver');
  const { getTenantSystemPrompt } = require('./prompt-profile-service');

  const profilePrompt = getTenantSystemPrompt(db, { customerId, clinicId });

  return {
    merchantId,
    customerId,
    clinicId,
    customer,
    settings,
    customPrompt: profilePrompt || null,
    kellyStatus,
    agentEnabled,
    greeting: resolveGreetingWithDisclosure(settings, customer, { aiDisclosureEnabled }),
    afterHoursMessage: buildAfterHoursMessage(settings),
    unavailableMessage: buildUnavailableMessage(),
    businessHours: settings?.business_hours || null,
    coverageMode,
    coverageHours: settings?.coverage_hours || null,
    afterHoursAction,
    transferNumber,
    overflowNumber,
    portingStatus: settings?.porting_status || 'not_started',
    aiDisclosureEnabled,
    voiceReplySuppressEnabled
  };
}

/**
 * Evaluate whether call should proceed
 * @returns {{ allowed: boolean, reason?: string, message?: string, greeting?: string }}
 */
const TRANSFER_USER_RE =
  /\b(speak to|talk to|human|representative|front desk|receptionist|real person|someone there|operator|live person|staff member)\b/i;
const TRANSFER_AGENT_RE =
  /\b(connect you with|transfer you|let me get someone|speak with (a |our )?(staff|team|member|person|someone))\b/i;

function detectTransferHint(userSaid, agentReply) {
  if (userSaid && TRANSFER_USER_RE.test(String(userSaid))) return 'transferred';
  if (agentReply && TRANSFER_AGENT_RE.test(String(agentReply))) return 'transferred';
  return null;
}

/**
 * @param {object|null} appointment schedule_appointment result row
 */
function outcomeForScheduledAppointment(appointment) {
  if (!appointment) return 'booked';
  const needsPa =
    appointment.requires_prior_auth === 1 ||
    appointment.requires_prior_auth === true ||
    String(appointment.auth_status || '').toLowerCase() === 'pending' ||
    String(appointment.auth_status || '').toLowerCase() === 'required';
  return needsPa ? 'pa_flagged' : 'booked';
}

/**
 * @param {object} params
 * @param {object|null} params.callLog
 * @param {object|null} params.connection
 * @param {number} params.callDurationSeconds
 * @param {object} params.db database module with .db
 */
function resolveCallEndOutcome({ callLog, connection, callDurationSeconds, db }) {
  if (callLog?.outcome) return callLog.outcome;
  if (connection?.voiceOutcomeHint) return connection.voiceOutcomeHint;
  const callId = callLog?.call_id || connection?.callId;
  if (callId && db?.db) {
    try {
      const toolBooked = db.db.prepare(`
        SELECT 1 FROM function_call_log
        WHERE call_id = ? AND function_name = 'schedule_appointment' AND success = 1
        LIMIT 1
      `).get(callId);
      if (toolBooked) return 'booked';
    } catch (_) {}
  }
  if (callDurationSeconds < 45) return 'voicemail';
  return 'info';
}

function evaluateCallAdmission(runtime, now = new Date()) {
  const transfer = runtime.transferNumber || null;
  const defaultForward = resolveForwardAction(transfer);

  if (!runtime.agentEnabled) {
    return {
      allowed: false,
      action: defaultForward,
      reason: 'disabled',
      message: runtime.unavailableMessage,
      transferNumber: defaultForward === 'forward_pstn' ? transfer : null
    };
  }

  if (
    runtime.coverageMode === 'coverage' &&
    runtime.coverageHours &&
    Object.keys(runtime.coverageHours).length > 0 &&
    !isWithinBusinessHours(runtime.coverageHours, now)
  ) {
    return {
      allowed: false,
      action: defaultForward,
      reason: 'coverage_off',
      message: runtime.afterHoursMessage,
      transferNumber: defaultForward === 'forward_pstn' ? transfer : null
    };
  }

  if (!isWithinBusinessHours(runtime.businessHours, now)) {
    const wantsTransfer = runtime.afterHoursAction === 'transfer' && transfer;
    return {
      allowed: false,
      action: wantsTransfer ? 'forward_pstn' : 'hangup',
      reason: 'after_hours',
      message: runtime.afterHoursMessage,
      transferNumber: wantsTransfer ? transfer : null
    };
  }

  return {
    allowed: true,
    action: 'connect',
    reason: 'open',
    greeting: runtime.greeting
  };
}

module.exports = {
  isWithinBusinessHours,
  normalizeBusinessHours,
  buildUnavailableMessage,
  buildAfterHoursMessage,
  buildDefaultGreeting,
  resolveGreeting,
  formatCallerLabel,
  formatCallerLabelFromCallRow,
  detectTransferHint,
  outcomeForScheduledAppointment,
  resolveCallEndOutcome,
  resolveTenantFromCallMeta,
  loadProviderVoiceRuntime,
  evaluateCallAdmission,
  parseJsonHours,
  resolveTransferNumber,
  resolveOverflowNumber,
  resolveForwardAction
};
