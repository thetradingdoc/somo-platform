'use strict';

const {
  getSignupTrialMinutes,
  getTrialDurationDays,
  getTrialInactivityReleaseDays
} = require('./plan-catalog');

class TrialProvisionError extends Error {
  constructor(message, code = 'twilio_provision_failed', details = {}) {
    super(message);
    this.name = 'TrialProvisionError';
    this.code = code;
    this.details = details;
  }
}

function isFlagEnabled() {
  const v = process.env.TRIAL_SIM_FLOW_ENABLED;
  return v === '1' || v === 'true';
}

function parseLaunchAt() {
  const raw = process.env.TRIAL_SIM_LAUNCH_AT;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Whether this customer should use SIM trial signup (SaaS only, new signups after launch).
 */
function isTrialSimEnabledForCustomer(customer) {
  if (!customer || customer.customer_type !== 'saas') return false;
  if (!isFlagEnabled()) return false;

  if (customer.subscription_status === 'active' && customer.stripe_subscription_id) {
    return false;
  }

  const launch = parseLaunchAt();
  if (launch && customer.created_at) {
    const created = new Date(customer.created_at);
    if (created < launch) return false;
  }

  return true;
}

function getTrialMinutesAllocated() {
  return getSignupTrialMinutes();
}

function getTrialMinutesConsumed(db, customer) {
  if (!customer?.id || !customer.trial_started_at) return 0;
  return db.getTrialMinutesConsumed(customer.id, customer.trial_started_at);
}

function getTrialMinutesRemaining(db, customer) {
  const allocated = getTrialMinutesAllocated();
  const consumed = getTrialMinutesConsumed(db, customer);
  return Math.max(0, allocated - consumed);
}

function isTrialTimeExpired(customer) {
  if (!customer?.trial_expires_at) return false;
  return Date.now() >= new Date(customer.trial_expires_at).getTime();
}

function isTrialAccessAllowed(db, customer) {
  if (!customer || customer.trial_status !== 'active') return false;
  if (!customer.twilio_phone_number) return false;
  if (isTrialTimeExpired(customer)) return false;
  if (getTrialMinutesRemaining(db, customer) <= 0) return false;
  return true;
}

function canStartTrial(db, customerId, phoneE164) {
  const customer = db.getCustomer(customerId);
  if (!customer) return { allowed: false, reason: 'customer_not_found' };
  if (!isTrialSimEnabledForCustomer(customer)) {
    return { allowed: false, reason: 'trial_sim_disabled' };
  }
  if (customer.trial_status === 'active' && customer.twilio_phone_number) {
    return { allowed: false, reason: 'trial_already_active' };
  }
  if (customer.subscription_status === 'active') {
    return { allowed: false, reason: 'already_subscribed' };
  }

  const duplicate = db.findActiveTrialCustomerByPhone(phoneE164, customerId);
  if (duplicate) {
    return { allowed: false, reason: 'phone_trial_in_use' };
  }

  return { allowed: true, reason: 'ok' };
}

function apiBaseUrl() {
  const strip = (u) => String(u || '').replace(/\/$/, '');
  const isLocalHost = (u) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(strip(u));

  let base = strip(
    process.env.API_BASE_URL ||
      process.env.BASE_URL ||
      (process.env.NODE_ENV === 'production' ? 'https://api.callsomo.com' : 'http://localhost:4000')
  );

  if (isLocalHost(base)) {
    const ngrok = strip(process.env.NGROK_URL);
    if (ngrok && /^https:\/\//i.test(ngrok)) {
      base = ngrok;
    }
  }

  return base;
}

function parseProvisionJson(customer) {
  try {
    return customer.trial_provision_json ? JSON.parse(customer.trial_provision_json) : {};
  } catch (_) {
    return {};
  }
}

/**
 * Keep trial_provision_json.twilio_provisioned aligned with persisted DID columns.
 */
function syncTwilioProvisionFlags(provision, customer) {
  const hasDid =
    !!(customer?.twilio_phone_number && String(customer.twilio_phone_number).trim()) &&
    !!(customer?.twilio_phone_sid && String(customer.twilio_phone_sid).trim());
  if (hasDid) {
    provision.twilio_provisioned = true;
    delete provision.twilio_provision_error;
  } else {
    provision.twilio_provisioned = false;
    if (!provision.twilio_provision_error) {
      provision.twilio_provision_error = 'Dedicated line not persisted on customer record';
    }
  }
  return provision;
}

/**
 * Purchase dedicated inbound number before trial activates.
 * @returns {{ phoneNumber: string, sid: string, searchStrategy?: string }}
 */
async function provisionDedicatedNumber(db, customerId, options = {}) {
  const customer = db.getCustomer(customerId);
  if (!customer) throw new Error('Customer not found');

  if (customer.twilio_phone_number && customer.twilio_phone_sid) {
    return {
      phoneNumber: customer.twilio_phone_number,
      sid: customer.twilio_phone_sid,
      alreadyProvisioned: true
    };
  }

  const TwilioPhoneService = require('../voice/twilio-phone-service');
  const twilio = new TwilioPhoneService();
  if (!twilio.isAvailable()) {
    throw new TrialProvisionError(
      'Twilio is not configured. Cannot assign a dedicated clinic line.',
      'twilio_not_configured'
    );
  }

  const phoneE164 = options.phoneE164 || customer.phone_number;
  const webhookUrl = `${apiBaseUrl()}/voice/incoming?customer_id=${customerId}`;

  try {
    const purchased = await twilio.provisionPhoneNumberForCustomer({
      customerId,
      phoneE164,
      webhookUrl
    });

    db.updateCustomer(customerId, {
      twilio_phone_number: purchased.phoneNumber,
      twilio_phone_sid: purchased.sid
    });

    return {
      phoneNumber: purchased.phoneNumber,
      sid: purchased.sid,
      searchStrategy: purchased.searchStrategy
    };
  } catch (e) {
    let message = e.message || 'Failed to provision dedicated phone number';
    if (/VoiceUrl is not valid|21402/i.test(message) && /localhost|127\.0\.0\.1/i.test(webhookUrl)) {
      message +=
        ' Set NGROK_URL (run ngrok http 4000) or API_BASE_URL to a public HTTPS URL, then restart the server.';
    }
    throw new TrialProvisionError(message, 'twilio_provision_failed', { cause: e.message });
  }
}

function activateTrialRecord(db, customerId, options = {}) {
  const customer = db.getCustomer(customerId);
  if (!customer) throw new Error('Customer not found');
  if (!options.skipPhoneVerifyGate && Number(customer.phone_verified) !== 1) {
    throw new TrialProvisionError(
      'Contact phone must be verified before activating trial',
      'phone_not_verified'
    );
  }

  const now = new Date();
  const expires = new Date(now.getTime() + getTrialDurationDays() * 24 * 60 * 60 * 1000);
  const phone = options.phoneE164;

  db.updateCustomer(customerId, {
    trial_status: 'active',
    trial_started_at: now.toISOString(),
    trial_expires_at: expires.toISOString(),
    trial_phone_verified_at: options.phoneVerifiedAt || now.toISOString(),
    phone_verified: 1,
    phone_verified_at: options.phoneVerifiedAt || now.toISOString(),
    phone_number: phone,
    trial_release_reason: null
  });

  if (!options.skipWelcomeNudge) {
    try {
      const { maybeSendTrialWelcome } = require('./trial-alerts');
      maybeSendTrialWelcome(customerId).catch((e) => {
        console.warn('[TrialLifecycle] welcome nudge:', e.message);
      });
    } catch (_) {}
  }

  return { now, expires };
}

/**
 * Idempotent: provision dedicated number, then activate trial + credits + Retell.
 */
async function startTrialTenant(db, customerId, options = {}) {
  const customer = db.getCustomer(customerId);
  if (!customer) throw new Error('Customer not found');

  const phone = options.phoneE164 || customer.phone_number;
  const gate = canStartTrial(db, customerId, phone);
  if (!gate.allowed) {
    if (gate.reason === 'trial_already_active') {
      const existing = db.getCustomer(customerId);
      return {
        success: true,
        already_active: true,
        customer_id: customerId,
        twilio_phone_number: existing.twilio_phone_number,
        trial_minutes_remaining: getTrialMinutesRemaining(db, existing),
        provision: parseProvisionJson(existing)
      };
    }
    throw new Error(`Cannot start trial: ${gate.reason}`);
  }

  const trialMinutes = getTrialMinutesAllocated();
  let provision = parseProvisionJson(customer);

  const purchased = await provisionDedicatedNumber(db, customerId, {
    phoneE164: phone
  });
  if (purchased.searchStrategy) provision.twilio_search_strategy = purchased.searchStrategy;

  if (!purchased.phoneNumber) {
    throw new TrialProvisionError(
      'Dedicated phone number is required to start your trial',
      'twilio_provision_failed'
    );
  }

  const afterNumber = db.getCustomer(customerId);
  if (afterNumber.trial_status !== 'active') {
    activateTrialRecord(db, customerId, {
      phoneE164: phone || afterNumber.phone_number,
      phoneVerifiedAt: options.phoneVerifiedAt
    });
  }

  const refreshed = db.getCustomer(customerId);

  if (!provision.credits_allocated) {
    try {
      db.allocateFreeCredits(customerId, trialMinutes);
      provision.credits_allocated = true;
    } catch (e) {
      console.warn('[TrialLifecycle] allocateFreeCredits:', e.message);
      provision.credits_error = e.message;
    }
  }

  let retellAgentId = refreshed.retell_agent_id;
  if (!retellAgentId && !provision.retell_skipped) {
    try {
      const RetellService = require('../voice/retell-service');
      const retellService = new RetellService();
      const agentResult = await retellService.createAgent({
        name: refreshed.company_name || refreshed.name,
        phone_number: refreshed.phone_number
      });
      if (agentResult.success) {
        retellAgentId = agentResult.agent_id;
        db.updateCustomerRetellAgent(customerId, retellAgentId, 'active');
        provision.retell_agent_id = retellAgentId;
      } else {
        provision.retell_error = agentResult.error;
      }
    } catch (e) {
      provision.retell_error = e.message;
    }
  }

  if (!provision.merchant_id && !refreshed.merchant_id) {
    provision.merchant_deferred = true;
  }

  const final = db.getCustomer(customerId);
  syncTwilioProvisionFlags(provision, final);

  db.updateCustomer(customerId, {
    trial_provision_json: JSON.stringify(provision)
  });
  if (db.upsertVoiceAgentSettings && (final.merchant_id || final.id)) {
    try {
      const VoiceAgentRuntime = require('../voice/voice-agent-runtime');
      const VoicePromptTemplates = require('../voice/voice-prompt-templates');
      const {
        resolvePracticeDisplayName,
        buildDefaultInboundGreeting,
        buildDefaultOutboundOpener
      } = require('../voice/call-opener-resolver');
      const company = resolvePracticeDisplayName(db, { customerId: final.id, customer: final });
      const seedSettings = {
        retell_agent_id: final.retell_agent_id || null,
        enabled: true,
        greeting: buildDefaultInboundGreeting(company, 'warm'),
        outbound_opener: buildDefaultOutboundOpener(company, 'warm'),
        outbound_enabled: 0,
        after_hours_message: VoiceAgentRuntime.buildAfterHoursMessage({}),
        business_hours: { mon: '09:00-17:00', tue: '09:00-17:00', wed: '09:00-17:00', thu: '09:00-17:00', fri: '09:00-17:00' },
        tone_preset: 'warm',
        sync_status: 'synced'
      };
      db.upsertVoiceAgentSettings(
        final.merchant_id || db.customerVoiceSettingsMerchantKey(final.id),
        seedSettings,
        final.id
      );
      const defaultPrompt = VoicePromptTemplates.getDefaultCustomPrompt(final);
      if (defaultPrompt && !final.custom_prompt) {
        db.updateCustomer(final.id, { custom_prompt: defaultPrompt });
      }
    } catch (seedErr) {
      console.warn('[TrialLifecycle] voice_agent_settings seed:', seedErr.message);
    }
  }

  if (!final.twilio_phone_number) {
    throw new TrialProvisionError(
      'Trial could not be started without a dedicated phone number',
      'twilio_provision_failed'
    );
  }

  return {
    success: true,
    customer_id: customerId,
    trial_status: final.trial_status,
    trial_expires_at: final.trial_expires_at,
    trial_minutes_allocated: trialMinutes,
    trial_minutes_remaining: getTrialMinutesRemaining(db, final),
    twilio_phone_number: final.twilio_phone_number,
    retell_agent_id: final.retell_agent_id,
    provision
  };
}

async function expireTrial(db, customerId, reason, options = {}) {
  const customer = db.getCustomer(customerId);
  if (!customer) return { success: false, reason: 'not_found' };

  const { releaseNumber = true, dryRun = false } = options;

  if (dryRun) {
    return {
      success: true,
      dry_run: true,
      customer_id: customerId,
      would_release: !!(releaseNumber && customer.twilio_phone_sid),
      reason
    };
  }

  if (releaseNumber && customer.twilio_phone_sid) {
    try {
      const TwilioPhoneService = require('../voice/twilio-phone-service');
      const twilio = new TwilioPhoneService();
      if (twilio.isAvailable()) {
        await twilio.releasePhoneNumber(customer.twilio_phone_sid);
      }
    } catch (e) {
      console.warn('[TrialLifecycle] release number failed:', e.message);
    }
    db.updateCustomer(customerId, {
      twilio_phone_number: null,
      twilio_phone_sid: null
    });
  }

  const status = reason === 'minutes_exhausted' ? 'exhausted' : 'expired';
  db.updateCustomer(customerId, {
    trial_status: status,
    trial_release_reason: reason
  });

  return { success: true, customer_id: customerId, trial_status: status, reason };
}

function convertTrialToPaid(db, customerId) {
  const customer = db.getCustomer(customerId);
  if (!customer) return { success: false };

  db.updateCustomer(customerId, {
    trial_status: 'converted',
    trial_release_reason: null,
    subscription_status: customer.subscription_status || 'active'
  });

  return { success: true, customer_id: customerId, trial_status: 'converted' };
}

function markTrialExhaustedIfNeeded(db, customerId) {
  const customer = db.getCustomer(customerId);
  if (!customer || customer.trial_status !== 'active') return false;
  if (getTrialMinutesRemaining(db, customer) > 0) return false;
  db.updateCustomer(customerId, { trial_status: 'exhausted' });
  return true;
}

function getSignupAttribution(customer) {
  try {
    return customer.signup_attribution_json
      ? JSON.parse(customer.signup_attribution_json)
      : {};
  } catch (_) {
    return {};
  }
}

function isSomoDemoSignup(customer) {
  const attr = getSignupAttribution(customer);
  const source = String(attr.utm_source || '').toLowerCase();
  // Legacy utm_source=dodgecall accepted read-only for existing signups
  return source === 'somo-demo' || source === 'somo' || source === 'dodgecall';
}

module.exports = {
  TrialProvisionError,
  isFlagEnabled,
  isTrialSimEnabledForCustomer,
  getTrialMinutesAllocated,
  getTrialMinutesConsumed,
  getTrialMinutesRemaining,
  isTrialTimeExpired,
  isTrialAccessAllowed,
  canStartTrial,
  syncTwilioProvisionFlags,
  provisionDedicatedNumber,
  startTrialTenant,
  expireTrial,
  convertTrialToPaid,
  markTrialExhaustedIfNeeded,
  getSignupAttribution,
  isSomoDemoSignup,
  getTrialInactivityReleaseDays
};
