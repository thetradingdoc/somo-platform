'use strict';

const {
  getSignupTrialMinutes,
  getTrialDurationDays,
  getTrialInactivityReleaseDays
} = require('./plan-catalog');

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
  if (customer.trial_status === 'active') {
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
  return (
    process.env.API_BASE_URL ||
    process.env.BASE_URL ||
    (process.env.NODE_ENV === 'production' ? 'https://api.doclittle.site' : 'http://localhost:4000')
  ).replace(/\/$/, '');
}

function parseProvisionJson(customer) {
  try {
    return customer.trial_provision_json ? JSON.parse(customer.trial_provision_json) : {};
  } catch (_) {
    return {};
  }
}

/**
 * Idempotent: provision dedicated number + Retell + 60 trial minutes.
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
        trial_minutes_remaining: getTrialMinutesRemaining(db, existing)
      };
    }
    throw new Error(`Cannot start trial: ${gate.reason}`);
  }

  const now = new Date();
  const expires = new Date(now.getTime() + getTrialDurationDays() * 24 * 60 * 60 * 1000);
  const trialMinutes = getTrialMinutesAllocated();

  const provision = parseProvisionJson(customer);

  if (customer.trial_status !== 'active') {
    db.updateCustomer(customerId, {
      trial_status: 'active',
      trial_started_at: now.toISOString(),
      trial_expires_at: expires.toISOString(),
      trial_phone_verified_at: options.phoneVerifiedAt || now.toISOString(),
      phone_verified: 1,
      phone_verified_at: options.phoneVerifiedAt || now.toISOString(),
      phone_number: phone || customer.phone_number,
      trial_release_reason: null
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
      const RetellService = require('./retell-service');
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

  let twilioPhone = refreshed.twilio_phone_number;
  let twilioSid = refreshed.twilio_phone_sid;
  if (!twilioPhone && !provision.twilio_failed_permanent) {
    try {
      const TwilioPhoneService = require('./twilio-phone-service');
      const twilio = new TwilioPhoneService();
      if (twilio.isAvailable()) {
        const webhookUrl = `${apiBaseUrl()}/voice/incoming?customer_id=${customerId}`;
        let areaCode = null;
        const digitsOnly = String(refreshed.phone_number || '').replace(/\D/g, '');
        if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
          areaCode = digitsOnly.substring(1, 4);
        } else if (digitsOnly.length === 10) {
          areaCode = digitsOnly.substring(0, 3);
        }
        const purchased = await twilio.provisionPhoneNumberForCustomer({
          customerId,
          areaCode,
          webhookUrl
        });
        twilioPhone = purchased.phoneNumber;
        twilioSid = purchased.sid;
        db.updateCustomer(customerId, {
          twilio_phone_number: twilioPhone,
          twilio_phone_sid: twilioSid
        });
        provision.twilio_provisioned = true;
      } else {
        provision.twilio_error = 'twilio_not_configured';
      }
    } catch (e) {
      provision.twilio_error = e.message;
      console.error('[TrialLifecycle] Twilio provision failed:', e.message);
    }
  }

  if (!provision.merchant_id && !refreshed.merchant_id) {
    provision.merchant_deferred = true;
  }

  db.updateCustomer(customerId, {
    trial_provision_json: JSON.stringify(provision)
  });

  const final = db.getCustomer(customerId);
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
      const TwilioPhoneService = require('./twilio-phone-service');
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

function isDodgecallSignup(customer) {
  const attr = getSignupAttribution(customer);
  return String(attr.utm_source || '').toLowerCase() === 'dodgecall';
}

module.exports = {
  isFlagEnabled,
  isTrialSimEnabledForCustomer,
  getTrialMinutesAllocated,
  getTrialMinutesConsumed,
  getTrialMinutesRemaining,
  isTrialTimeExpired,
  isTrialAccessAllowed,
  canStartTrial,
  startTrialTenant,
  expireTrial,
  convertTrialToPaid,
  markTrialExhaustedIfNeeded,
  getSignupAttribution,
  isDodgecallSignup,
  getTrialInactivityReleaseDays
};
