'use strict';

/**
 * Front-desk intake field store (session meta) — administrative registration, not OPQRST.
 */
const KellyToolExecutor = require('./kelly-tool-executor');
const IntakeRequiredFields = require('./intake-required-fields');
const { loadTenantPolicyFromProfile } = require('./conversation-mode/tenant-policy');
const { TriagePolicy } = require('./conversation-mode/tenant-policy');

const META_KEYS = {
  full_name: 'fd_full_name',
  date_of_birth: 'fd_dob',
  phone: 'fd_phone',
  patient_status: 'fd_patient_status',
  reason_for_visit: 'fd_reason_for_visit',
  subscriber_id: 'fd_subscriber_id',
  group_number: 'fd_group_number',
  family_caller: 'fd_family_caller'
};

const FIELD_ORDER = IntakeRequiredFields.getRequiredFieldsSchema().front_desk.minimum_required;

function metaGet(sessionId, field) {
  const key = META_KEYS[field] || field;
  return KellyToolExecutor._getSessionMeta(sessionId, key) || null;
}

function metaSet(sessionId, field, value) {
  const key = META_KEYS[field] || field;
  if (value != null && String(value).trim()) {
    KellyToolExecutor._setSessionMeta(sessionId, key, String(value).trim());
  }
}

function readFrontDeskState(sessionId) {
  const state = {};
  for (const field of FIELD_ORDER) {
    state[field] = metaGet(sessionId, field);
  }
  return state;
}

function evaluateFrontDeskIntake(sessionId) {
  return IntakeRequiredFields.evaluateRequiredFields('front_desk', readFrontDeskState(sessionId));
}

function frontDeskIntakeComplete(sessionId) {
  return evaluateFrontDeskIntake(sessionId).is_minimum_met;
}

function nextFrontDeskField(sessionId) {
  return IntakeRequiredFields.nextRequiredField('front_desk', readFrontDeskState(sessionId));
}

function isFrontDeskTenant(ctx = {}) {
  const policy = ctx.triage_policy || ctx.triagePolicy;
  if (policy === TriagePolicy.DISABLED) return true;
  if (ctx.front_desk_mode || ctx.flags?.front_desk_mode) return true;
  if (ctx.db && (ctx.clinicId || ctx.clinic_id)) {
    try {
      const loaded = loadTenantPolicyFromProfile(
        ctx.db,
        ctx.clinicId || ctx.clinic_id,
        ctx.customerId || ctx.customer_id
      );
      return loaded.triage_policy === TriagePolicy.DISABLED;
    } catch (_) {}
  }
  return false;
}

function storeFrontDeskFields(sessionId, fields = {}) {
  for (const [k, v] of Object.entries(fields)) {
    if (v != null && META_KEYS[k]) metaSet(sessionId, k, v);
  }
  try {
    const { persistFrontDeskProjection } = require('./kelly-rails/session-ssot');
    persistFrontDeskProjection(sessionId, readFrontDeskState(sessionId));
  } catch (_) {}
  const complete = frontDeskIntakeComplete(sessionId);
  if (complete) {
    KellyToolExecutor._setSessionMeta(sessionId, 'front_desk_intake_complete', '1');
    KellyToolExecutor._setSessionMeta(sessionId, 'basic_intake_complete', '1');
  }
  return { complete, missing: evaluateFrontDeskIntake(sessionId).missing_required };
}

function extractFieldFromMessage(field, message) {
  const msg = String(message || '').trim();
  if (!msg) return null;
  const lower = msg.toLowerCase();
  if (field === 'phone') {
    const m = msg.match(/\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
    return m ? m[0].replace(/\D/g, '').replace(/^1(\d{10})$/, '+1$1') : null;
  }
  if (field === 'date_of_birth') {
    const m = msg.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\b/);
    return m ? m[1] : null;
  }
  if (field === 'patient_status') {
    if (/new patient|first time|never been|nuevo paciente|новый пациент/i.test(lower)) return 'new';
    if (/returning|been here|existing|before|paciente existente|повторн/i.test(lower)) return 'returning';
    return null;
  }
  if (field === 'full_name') {
    if (/^\d+$/.test(msg.replace(/\s/g, ''))) return null;
    if (msg.length >= 2 && msg.length <= 80) return msg;
    return null;
  }
  if (field === 'reason_for_visit') {
    if (msg.length >= 3) return msg;
    return null;
  }
  return null;
}

const PROMPTS = {
  en: {
    full_name: 'May I have your full name, please?',
    date_of_birth: 'What is your date of birth?',
    phone: 'What is the best phone number to reach you?',
    patient_status: 'Are you a new patient with us, or have you been here before?',
    reason_for_visit: 'What is the reason for your visit today?'
  },
  es: {
    full_name: '¿Me puede dar su nombre completo, por favor?',
    date_of_birth: '¿Cuál es su fecha de nacimiento?',
    phone: '¿Cuál es el mejor número de teléfono para contactarle?',
    patient_status: '¿Es paciente nuevo o ya nos ha visitado antes?',
    reason_for_visit: '¿Cuál es el motivo de su visita hoy?'
  },
  zh: {
    full_name: '请问您的全名是？',
    date_of_birth: '请问您的出生日期是？',
    phone: '请问联系您的最佳电话号码是？',
    patient_status: '您是新患者还是老患者？',
    reason_for_visit: '请问您今天来访的原因是什么？'
  },
  ru: {
    full_name: 'Подскажите, пожалуйста, ваше полное имя?',
    date_of_birth: 'Какая у вас дата рождения?',
    phone: 'Какой номер телефона лучше использовать для связи?',
    patient_status: 'Вы новый пациент или уже обращались к нам раньше?',
    reason_for_visit: 'С какой целью вы обращаетесь сегодня?'
  }
};

function promptForField(field, locale = 'en') {
  const loc = String(locale || 'en').slice(0, 2);
  return (PROMPTS[loc] || PROMPTS.en)[field] || PROMPTS.en[field];
}

function failureMetaKey(field) {
  return `fd_fail_${field}`;
}

function recordFieldFailure(sessionId, field) {
  if (!sessionId || !field) return 0;
  const key = failureMetaKey(field);
  const prev = Number(KellyToolExecutor._getSessionMeta(sessionId, key) || 0);
  const next = prev + 1;
  KellyToolExecutor._setSessionMeta(sessionId, key, String(next));
  return next;
}

function resetFieldFailures(sessionId, field) {
  if (!sessionId || !field) return;
  KellyToolExecutor._setSessionMeta(sessionId, failureMetaKey(field), '0');
}

function shouldTransferOnIntakeFailure(sessionId, field, threshold = 2) {
  if (!sessionId || !field) return false;
  const count = Number(KellyToolExecutor._getSessionMeta(sessionId, failureMetaKey(field)) || 0);
  return count >= threshold;
}

module.exports = {
  META_KEYS,
  FIELD_ORDER,
  readFrontDeskState,
  evaluateFrontDeskIntake,
  frontDeskIntakeComplete,
  nextFrontDeskField,
  isFrontDeskTenant,
  storeFrontDeskFields,
  extractFieldFromMessage,
  promptForField,
  recordFieldFailure,
  resetFieldFailures,
  shouldTransferOnIntakeFailure
};
