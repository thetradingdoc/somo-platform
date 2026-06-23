'use strict';

const ONBOARDING_STATES = [
  'signup_started',
  'line_assigned',
  'terms_accepted',
  'activation_shown',
  'voice_setup_incomplete',
  'voice_setup_complete',
  'live',
  'provisioning_failed',
  'sync_failed'
];

const TERMINAL_AGENT_STATES = new Set(['voice_setup_complete', 'live']);

function parseMeta(customer) {
  try {
    return customer?.onboarding_meta_json ? JSON.parse(customer.onboarding_meta_json) : {};
  } catch (_) {
    return {};
  }
}

function getOnboardingState(customer) {
  if (!customer) return null;
  if (customer.onboarding_state && ONBOARDING_STATES.includes(customer.onboarding_state)) {
    return customer.onboarding_state;
  }
  return deriveStateFromLegacy(customer);
}

function deriveStateFromLegacy(customer) {
  if (!customer) return 'signup_started';
  if (customer.voice_setup_completed_at) {
    return customer.trial_status === 'active' || customer.twilio_phone_number ? 'live' : 'voice_setup_complete';
  }
  if (customer.twilio_phone_number && customer.trial_status === 'active') {
    return 'voice_setup_incomplete';
  }
  if (customer.terms_accepted_at || Number(customer.terms_accepted) === 1) {
    return 'terms_accepted';
  }
  if (customer.twilio_phone_number) {
    return 'line_assigned';
  }
  if (customer.email_verified) {
    return 'signup_started';
  }
  return 'signup_started';
}

/**
 * @param {object} db
 * @param {string} customerId
 * @param {string} nextState
 * @param {object} [metaPatch]
 */
function transitionState(db, customerId, nextState, metaPatch = {}) {
  if (!ONBOARDING_STATES.includes(nextState)) {
    throw new Error(`Invalid onboarding state: ${nextState}`);
  }
  const customer = db.getCustomer(customerId);
  if (!customer) throw new Error('Customer not found');

  const meta = { ...parseMeta(customer), ...metaPatch, [`${nextState}_at`]: new Date().toISOString() };
  const updates = {
    onboarding_state: nextState,
    onboarding_state_updated_at: new Date().toISOString(),
    onboarding_meta_json: JSON.stringify(meta)
  };

  if (nextState === 'voice_setup_complete' || nextState === 'live') {
    updates.voice_setup_completed_at = customer.voice_setup_completed_at || new Date().toISOString();
  }

  db.updateCustomer(customerId, updates);
  logOnboardingEvent(customerId, nextState, metaPatch);
  return { ...customer, ...updates, onboarding_meta: meta };
}

function logOnboardingEvent(customerId, state, meta = {}) {
  console.log(
    JSON.stringify({
      event: 'voice_onboarding_transition',
      customer_id: customerId,
      onboarding_state: state,
      wizard_step: meta.wizard_step || null,
      at: new Date().toISOString()
    })
  );
}

function resolveOnboardingDestination(customer) {
  const state = getOnboardingState(customer);
  const meta = parseMeta(customer);
  const blockers = [];

  if (!customer?.twilio_phone_number && state !== 'signup_started' && state !== 'provisioning_failed') {
    blockers.push('missing_dedicated_line');
  }

  let path = '/business/agent.html';
  let reason = state;

  switch (state) {
    case 'signup_started':
      path = '/signup.html';
      reason = 'complete_signup';
      break;
    case 'line_assigned':
      path = '/signup.html?step=terms';
      reason = 'accept_terms';
      break;
    case 'terms_accepted':
      path = '/business/trial-activation.html?welcome=1';
      reason = 'show_activation';
      break;
    case 'activation_shown':
    case 'voice_setup_incomplete':
      path = `/business/voice-setup.html?step=${meta.wizard_step || 1}`;
      reason = 'complete_voice_setup';
      break;
    case 'provisioning_failed':
      path = '/signup.html?step=phone';
      reason = 'retry_provisioning';
      break;
    case 'sync_failed':
      path = '/business/agent.html?sync=retry';
      reason = 'retry_sync';
      break;
    case 'voice_setup_complete':
    case 'live':
    default:
      path = '/business/agent.html';
      reason = 'agent_dashboard';
      break;
  }

  return { state, path, reason, blockers, wizard_step: meta.wizard_step || 1 };
}

function shouldAllowLegacyRedirectToAgent(customer) {
  const state = getOnboardingState(customer);
  return TERMINAL_AGENT_STATES.has(state);
}

module.exports = {
  ONBOARDING_STATES,
  TERMINAL_AGENT_STATES,
  parseMeta,
  getOnboardingState,
  deriveStateFromLegacy,
  transitionState,
  resolveOnboardingDestination,
  shouldAllowLegacyRedirectToAgent,
  logOnboardingEvent
};
