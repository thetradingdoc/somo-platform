'use strict';

const { isWithinBusinessHours } = require('./voice-agent-runtime');
const { resolveClinicForCustomer } = require('./tenant-voice-config');

function parseBusinessHours(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/**
 * Resolve Kelly front-desk nameplate for provider UI.
 * @returns {{ nameplate: string, label: string, enabled: boolean, in_business_hours: boolean, shadow_week_active: boolean }}
 */
function resolveKellyNameplate(db, { customer, voiceSettings, clinic } = {}) {
  const resolvedClinic =
    clinic || (customer?.id ? resolveClinicForCustomer(db, customer.id) : null);
  const shadowWeek = !!resolvedClinic?.shadow_week_active;

  if (shadowWeek && !resolvedClinic?.pilot_live_at) {
    return {
      nameplate: 'SHADOW',
      label: 'SHADOW',
      enabled: true,
      in_business_hours: true,
      shadow_week_active: true,
      shadow_week_ends_at: resolvedClinic?.shadow_week_ends_at || null
    };
  }

  const enabled = !!(voiceSettings?.enabled ?? voiceSettings?.enabled === 1);
  const hours = parseBusinessHours(voiceSettings?.business_hours);
  const inHours = hours ? isWithinBusinessHours(hours) : true;

  if (!enabled) {
    return {
      nameplate: 'PAUSED',
      label: 'PAUSED',
      enabled: false,
      in_business_hours: inHours,
      shadow_week_active: shadowWeek,
      shadow_week_ends_at: resolvedClinic?.shadow_week_ends_at || null
    };
  }

  if (!inHours) {
    return {
      nameplate: 'COVERAGE-OFF',
      label: 'COVERAGE-OFF',
      enabled: true,
      in_business_hours: false,
      shadow_week_active: shadowWeek,
      shadow_week_ends_at: resolvedClinic?.shadow_week_ends_at || null
    };
  }

  return {
    nameplate: 'LIVE',
    label: 'LIVE',
    enabled: true,
    in_business_hours: true,
    shadow_week_active: shadowWeek,
    shadow_week_ends_at: resolvedClinic?.shadow_week_ends_at || null
  };
}

function resolveVoiceAgentStatus(db, customer) {
  if (!customer) return null;
  const settings = db.getVoiceAgentSettingsForProvider?.({
    merchantId: customer.merchant_id,
    customerId: customer.id
  });
  const clinic = resolveClinicForCustomer(db, customer.id);
  const plate = resolveKellyNameplate(db, { customer, voiceSettings: settings, clinic });

  return {
    customer_id: customer.id,
    phone_number: customer.twilio_phone_number || null,
    transfer_number: clinic?.transfer_number || null,
    voice_agent_enabled: plate.enabled,
    enabled: plate.enabled,
    ...plate
  };
}

module.exports = {
  resolveKellyNameplate,
  resolveVoiceAgentStatus
};
