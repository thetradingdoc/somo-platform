'use strict';

/**
 * Single read API for per-tenant voice / front-desk configuration.
 */
const { normalizeLanguageConfig } = require('./tenant-language-config');
const { loadTenantPolicyFromProfile } = require('./conversation-mode/tenant-policy');
const { getEffectiveTenantPolicy } = require('./prompt-profile-templates');

const DAY_KEY_TO_NUM = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function parseJsonField(raw, fallback = null) {
  if (!raw) return fallback;
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  let current = raw;
  for (let i = 0; i < 3; i++) {
    if (typeof current !== 'string') break;
    try {
      current = JSON.parse(current);
    } catch (_) {
      return fallback;
    }
  }
  return current ?? fallback;
}

function resolveClinicForCustomer(db, customerId, clinicIdHint = null) {
  if (!db) return null;
  const sqlite = db.db || db;
  if (clinicIdHint) {
    try {
      const direct = sqlite.prepare('SELECT * FROM clinics WHERE clinic_id = ?').get(clinicIdHint);
      if (direct) return direct;
    } catch (_) {}
  }
  if (!customerId) return null;
  try {
    return sqlite
      .prepare(
        `SELECT c.* FROM clinics c
         JOIN customer_clinics cc ON cc.clinic_id = c.clinic_id
         WHERE cc.customer_id = ?
         ORDER BY cc.is_primary DESC, c.created_at ASC
         LIMIT 1`
      )
      .get(customerId);
  } catch (_) {
    try {
      const customer = db.getCustomer?.(customerId);
      if (customer?.merchant_id) {
        return sqlite
          .prepare('SELECT * FROM clinics WHERE merchant_id = ? AND is_active = 1 LIMIT 1')
          .get(customer.merchant_id);
      }
    } catch (_2) {}
    return null;
  }
}

function voiceHoursToSchedulingColumns(businessHours) {
  const hours = parseJsonField(businessHours, businessHours) || {};
  const business_days = [];
  let start = 9;
  let end = 17;
  const ranges = Object.values(hours).filter(Boolean);
  for (const [key, val] of Object.entries(hours)) {
    const dayNum = DAY_KEY_TO_NUM[String(key).slice(0, 3).toLowerCase()];
    if (dayNum == null || !val || val === 'closed') continue;
    business_days.push(dayNum);
    const m = String(val).match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
    if (m) {
      start = Math.min(start, parseInt(m[1], 10));
      end = Math.max(end, parseInt(m[3], 10));
    }
  }
  return {
    business_days: business_days.length ? [...new Set(business_days)].sort() : [1, 2, 3, 4, 5],
    business_hours_start: start,
    business_hours_end: end
  };
}

function assessConfigStatus(config = {}) {
  const missing = [];
  const hours =
    config.business_hours &&
    typeof config.business_hours === 'object' &&
    !Array.isArray(config.business_hours) &&
    Object.keys(config.business_hours).length > 0
      ? config.business_hours
      : null;
  if (!config.customer_clinics_linked) missing.push('customer_clinics');
  if (!config.clinic_id) missing.push('clinic_id');
  if (!config.retell_agent_id) missing.push('retell_agent_id');
  if (!config.prompt_profile_id) missing.push('prompt_profile');
  if (!config.transfer_number && !config.transfer_fallback_acknowledged) {
    missing.push('transfer_number');
  }
  if (!hours) missing.push('business_hours');
  if (!config.language_mode) missing.push('language_mode');
  if (!config.clinic_email) missing.push('clinic_email');
  const ready = missing.length === 0;
  return {
    status: ready ? 'ready' : 'incomplete',
    missing,
    ready
  };
}

/**
 * @returns {object} merged tenant voice config
 */
function resolveTenantVoiceConfig(db, { clinicId, customerId, merchantId } = {}) {
  if (!db) {
    return { language_mode: 'en_only', supported_languages: ['en'], config_status: { status: 'incomplete', missing: ['db'], ready: false } };
  }

  const customer = customerId ? db.getCustomer?.(customerId) : null;
  const effectiveMerchantId =
    merchantId || customer?.merchant_id || (customerId ? db.customerVoiceSettingsMerchantKey?.(customerId) : null);

  const clinic = resolveClinicForCustomer(db, customerId, clinicId);
  const resolvedClinicId = clinic?.clinic_id || clinicId || null;

  let customerClinicsLinked = false;
  if (customerId && resolvedClinicId && db.db) {
    try {
      const row = db.db
        .prepare('SELECT 1 FROM customer_clinics WHERE customer_id = ? AND clinic_id = ?')
        .get(customerId, resolvedClinicId);
      customerClinicsLinked = !!row;
    } catch (_) {}
  }

  const voiceSettings = db.getVoiceAgentSettingsForProvider?.({
    merchantId: effectiveMerchantId,
    customerId,
    clinicId: resolvedClinicId
  });

  const lang = normalizeLanguageConfig({
    language_mode: voiceSettings?.language_mode,
    supported_languages: voiceSettings?.supported_languages
  });

  let promptProfile = null;
  if (db.getClinicPromptProfile) {
    promptProfile = db.getClinicPromptProfile(resolvedClinicId, customerId);
  }

  const policy = promptProfile
    ? getEffectiveTenantPolicy(promptProfile)
    : loadTenantPolicyFromProfile(db, resolvedClinicId, customerId);

  const business_hours = parseJsonField(voiceSettings?.business_hours, voiceSettings?.business_hours);

  const config = {
    customer_id: customerId || customer?.id || null,
    clinic_id: resolvedClinicId,
    merchant_id: effectiveMerchantId,
    clinic_name: clinic?.name || customer?.company_name || customer?.name || null,
    clinic_email: clinic?.email || customer?.email || null,
    clinic_phone: clinic?.phone_number || customer?.twilio_phone_number || null,
    transfer_number: clinic?.transfer_number || clinic?.fallback_pstn || null,
    transfer_fallback_acknowledged: !!clinic?.phone_number && !clinic?.transfer_number,
    twilio_phone_number: customer?.twilio_phone_number || null,
    retell_agent_id: customer?.retell_agent_id || voiceSettings?.retell_agent_id || null,
    greeting: voiceSettings?.greeting || null,
    after_hours_message: voiceSettings?.after_hours_message || null,
    outbound_opener: voiceSettings?.outbound_opener || null,
    outbound_enabled: !!(voiceSettings?.outbound_enabled === 1 || voiceSettings?.outbound_enabled === true),
    business_hours,
    tone_preset: voiceSettings?.tone_preset || 'warm',
    language_mode: lang.language_mode,
    supported_languages: lang.supported_languages,
    prompt_profile_id: promptProfile?.id || null,
    prompt_profile: promptProfile,
    use_case: promptProfile?.use_case || 'healthcare_clinic',
    triage_policy: policy?.triage_policy || 'disabled',
    policy,
    copay_quote_speak_enabled:
      voiceSettings?.copay_quote_speak_enabled === 1 ||
      voiceSettings?.copay_quote_speak_enabled === true ||
      parseJsonField(promptProfile?.policy_json, {})?.copay_quote_speak_enabled === true,
    customer_clinics_linked: customerClinicsLinked,
    enabled: voiceSettings?.enabled !== 0 && voiceSettings?.enabled !== false
  };

  config.config_status = assessConfigStatus(config);
  return config;
}

function syncVoiceHoursToClinic(db, clinicId, businessHours) {
  if (!db?.updateClinic || !clinicId || !businessHours) return;
  const scheduling = voiceHoursToSchedulingColumns(businessHours);
  db.updateClinic(clinicId, {
    business_hours: JSON.stringify(businessHours),
    business_hours_start: scheduling.business_hours_start,
    business_hours_end: scheduling.business_hours_end,
    business_days: JSON.stringify(scheduling.business_days)
  });
}

function setCopayQuoteSpeakEnabled(db, clinicId, enabled) {
  if (!db?.db || !clinicId) return false;
  const on = enabled === true || enabled === 1 || enabled === '1';
  const profile = db.db
    .prepare('SELECT id, policy_json FROM prompt_profiles WHERE clinic_id = ? LIMIT 1')
    .get(clinicId);
  if (profile?.id) {
    let policy = {};
    try {
      policy = parseJsonField(profile.policy_json, {}) || {};
    } catch (_) {}
    policy.copay_quote_speak_enabled = on;
    db.db
      .prepare(`UPDATE prompt_profiles SET policy_json = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(policy), profile.id);
  }
  return true;
}

function setVoiceReplySuppressEnabled(db, clinicId, enabled) {
  if (!db?.db || !clinicId) return false;
  const on = enabled === true || enabled === 1 || enabled === '1';
  const vas = db.db.prepare('SELECT id FROM voice_agent_settings WHERE clinic_id = ? LIMIT 1').get(clinicId);
  if (vas?.id) {
    db.db
      .prepare(
        `UPDATE voice_agent_settings SET voice_reply_suppress_enabled = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .run(on ? 1 : 0, vas.id);
    return true;
  }
  return false;
}

function ensureCustomerClinicLink(db, customerId, clinicId, { isPrimary = true } = {}) {
  if (!db?.db || !customerId || !clinicId) return false;
  try {
    db.db
      .prepare(
        `INSERT OR IGNORE INTO customer_clinics (customer_id, clinic_id, is_primary, created_at)
         VALUES (?, ?, ?, datetime('now'))`
      )
      .run(customerId, clinicId, isPrimary ? 1 : 0);
    return true;
  } catch (e) {
    console.warn('[tenant-voice-config] customer_clinics link failed:', e.message);
    return false;
  }
}

module.exports = {
  resolveTenantVoiceConfig,
  resolveClinicForCustomer,
  assessConfigStatus,
  syncVoiceHoursToClinic,
  voiceHoursToSchedulingColumns,
  ensureCustomerClinicLink,
  setCopayQuoteSpeakEnabled,
  setVoiceReplySuppressEnabled,
  parseJsonField
};
