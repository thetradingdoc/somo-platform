/**
 * Inbound call and provisioning access rules for voice SaaS billing.
 */

const {
  getPastDueGraceDays,
  getNumberRetentionDays,
  getMaxRequestsPerMinute,
  getMaxConcurrentCalls,
  getMaxPhoneNumbers,
  getTier
} = require('./plan-catalog');
const { getTotalAvailableMinutes } = require('./apply-usage');
const { hasCapability } = require('./customer-capabilities');
const {
  isTrialSimEnabledForCustomer,
  isTrialAccessAllowed,
  isTrialTimeExpired,
  getTrialMinutesRemaining
} = require('./trial-lifecycle');

const BLOCKED_STATUSES_AFTER_GRACE = new Set(['suspended', 'canceled', 'unpaid', 'incomplete_expired']);

const TRIAL_PAUSED_MESSAGE =
  'Your AI receptionist trial is paused. Activate your plan to keep answering calls.';

function isPastDueGraceExpired(customer) {
  if (customer.subscription_status !== 'past_due' || !customer.past_due_since) {
    return false;
  }
  const graceMs = getPastDueGraceDays() * 24 * 60 * 60 * 1000;
  return Date.now() - new Date(customer.past_due_since).getTime() > graceMs;
}

function isSubscriptionBlocking(customer) {
  const status = customer.subscription_status || 'trialing';
  if (status === 'active' || status === 'trialing') return false;
  if (status === 'past_due') return isPastDueGraceExpired(customer);
  return BLOCKED_STATUSES_AFTER_GRACE.has(status);
}

function hasActivePaidSubscription(customer) {
  return customer.subscription_status === 'active' && !!customer.stripe_subscription_id;
}

/**
 * @param {object} db
 * @param {string} customerId
 */
function canAcceptInboundCall(db, customerId) {
  const customer = db.getCustomer(customerId);
  if (!customer) {
    return { allowed: false, reason: 'customer_not_found', message: 'Account not found.' };
  }

  if (customer.billing_enforcement_paused === 1) {
    return { allowed: true, reason: 'enforcement_paused' };
  }

  if (hasActivePaidSubscription(customer)) {
    const minutes = getTotalAvailableMinutes(db, customerId);
    if (minutes <= 0) {
      return {
        allowed: false,
        reason: 'no_minutes',
        message: 'We are unable to take your call right now. Please try again later or visit our website.'
      };
    }
    return { allowed: true, reason: 'ok', minutes_remaining: minutes };
  }

  if (isTrialSimEnabledForCustomer(customer) && customer.trial_status === 'active') {
    if (isTrialAccessAllowed(db, customer)) {
      const trialRemaining = getTrialMinutesRemaining(db, customer);
      return {
        allowed: true,
        reason: 'trial_active',
        minutes_remaining: trialRemaining,
        trial: true
      };
    }
    if (isTrialTimeExpired(customer)) {
      return {
        allowed: false,
        reason: 'trial_expired',
        message: TRIAL_PAUSED_MESSAGE
      };
    }
    return {
      allowed: false,
      reason: 'trial_minutes_exhausted',
      message: TRIAL_PAUSED_MESSAGE
    };
  }

  if (isSubscriptionBlocking(customer)) {
    return {
      allowed: false,
      reason: 'subscription_inactive',
      message: 'This line is temporarily unavailable. Please try again later or contact the practice.'
    };
  }

  const minutes = getTotalAvailableMinutes(db, customerId);
  if (minutes <= 0) {
    return {
      allowed: false,
      reason: 'no_minutes',
      message: 'We are unable to take your call right now. Please try again later or visit our website.'
    };
  }

  return { allowed: true, reason: 'ok', minutes_remaining: minutes };
}

/**
 * Outbound voice gate — plan outbound flag + minute pool (operator unlimited bypass).
 */
function canInitiateOutboundCall(db, customerId) {
  const customer = db.getCustomer(customerId);
  if (!customer) {
    return { allowed: false, reason: 'customer_not_found', message: 'Account not found.' };
  }

  if (customer.billing_enforcement_paused === 1) {
    return { allowed: true, reason: 'enforcement_paused' };
  }

  if (hasCapability(customer, 'voice.outbound_unlimited')) {
    return { allowed: true, reason: 'operator_unlimited' };
  }

  const tier = getTier(customer.plan_tier || 'starter');
  const outboundAllowed =
    hasCapability(customer, 'voice.outbound') || tier.feature_flags?.outbound === true;
  if (!outboundAllowed) {
    return {
      allowed: false,
      reason: 'plan_no_outbound',
      message: 'Outbound calling is not included in your plan. Please upgrade to enable outbound calls.'
    };
  }

  return canAcceptInboundCall(db, customerId);
}

function canProvisionNumber(db, customerId) {
  const customer = db.getCustomer(customerId);
  if (!customer) return { allowed: false, reason: 'customer_not_found' };

  const slotCheck = canAddPhoneNumber(db, customerId);
  if (!slotCheck.allowed) return slotCheck;

  const status = customer.subscription_status || '';
  if (status === 'active') return { allowed: true, reason: 'active_subscription' };

  if (customer.stripe_subscription_id && ['trialing', 'past_due'].includes(status)) {
    return { allowed: true, reason: 'subscription_pending_ok' };
  }

  if (
    isTrialSimEnabledForCustomer(customer) &&
    customer.trial_status === 'active' &&
    customer.phone_verified === 1
  ) {
    return { allowed: true, reason: 'sim_trial_active' };
  }

  return { allowed: false, reason: 'payment_required' };
}

function escapeTwimlText(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildBlockedTwiml(message) {
  const safe = escapeTwimlText(message || 'This service is unavailable.');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${safe}</Say>
  <Hangup/>
</Response>`;
}

/** Forward to practice line when overflow/credits-exhausted and a PSTN target exists. */
function buildForwardOrBlockedTwiml(message, transferNumber) {
  const pstn = String(transferNumber || '').replace(/\D/g, '');
  if (pstn.length >= 10) {
    const safe = escapeTwimlText(message || 'Please hold while we connect you.');
    const dial = escapeTwimlText(transferNumber);
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${safe}</Say>
  <Dial>${dial}</Dial>
</Response>`;
  }
  return buildBlockedTwiml(message);
}

const OVERFLOW_FORWARD_REASONS = new Set([
  'no_minutes',
  'trial_minutes_exhausted',
  'trial_expired',
  'concurrent_overflow'
]);

function getRateLimitForCustomer(customer) {
  return getMaxRequestsPerMinute(customer?.plan_tier || 'starter');
}

function getConcurrentCallsForCustomer(customer) {
  return getMaxConcurrentCalls(customer?.plan_tier || 'starter');
}

function canAddPhoneNumber(db, customerId) {
  const customer = db.getCustomer(customerId);
  if (!customer) return { allowed: false, reason: 'customer_not_found' };
  const max = getMaxPhoneNumbers(customer.plan_tier || 'starter');
  const count = db.countCustomerPhoneNumbers
    ? db.countCustomerPhoneNumbers(customerId)
    : customer.twilio_phone_number
      ? 1
      : 0;
  if (count >= max) {
    return { allowed: false, reason: 'max_phone_numbers', max, current: count };
  }
  return { allowed: true, max, current: count };
}

module.exports = {
  canAcceptInboundCall,
  canInitiateOutboundCall,
  canProvisionNumber,
  isSubscriptionBlocking,
  isPastDueGraceExpired,
  buildBlockedTwiml,
  buildForwardOrBlockedTwiml,
  OVERFLOW_FORWARD_REASONS,
  getRateLimitForCustomer,
  getConcurrentCallsForCustomer,
  canAddPhoneNumber,
  getNumberRetentionDays,
  TRIAL_PAUSED_MESSAGE
};

