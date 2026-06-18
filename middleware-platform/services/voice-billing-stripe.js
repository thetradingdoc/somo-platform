/**
 * Stripe webhooks and checkout helpers for voice SaaS subscription billing.
 */

const Stripe = require('stripe');
const db = require('../database');
const { getTier, getTopupPack } = require('./plan-catalog');
const { canProvisionNumber } = require('./billing-access');
const TwilioPhoneService = require('./twilio-phone-service');

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY not set');
  return new Stripe(key, { apiVersion: '2024-04-10' });
}

function priceIdForTier(tierId) {
  const map = {
    starter: process.env.STRIPE_PRICE_STARTER,
    practice: process.env.STRIPE_PRICE_PRACTICE,
    clinic_pro: process.env.STRIPE_PRICE_CLINIC_PRO
  };
  return map[tierId] || null;
}

function priceIdForTopup(packId) {
  const map = {
    small: process.env.STRIPE_PRICE_TOPUP_SMALL,
    standard: process.env.STRIPE_PRICE_TOPUP_STANDARD,
    large: process.env.STRIPE_PRICE_TOPUP_LARGE
  };
  return map[packId] || null;
}

function apiBaseUrl() {
  return (process.env.API_BASE_URL || process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
}

function portalBaseUrl() {
  return (process.env.ADMIN_PORTAL_BASE_URL || process.env.BASE_URL || apiBaseUrl()).replace(/\/$/, '');
}

async function ensureStripeCustomer(customer) {
  if (customer.stripe_customer_id) return customer.stripe_customer_id;
  const stripe = getStripe();
  const sc = await stripe.customers.create({
    email: customer.email,
    name: customer.company_name || customer.name,
    metadata: { customer_id: customer.id }
  });
  db.updateCustomer(customer.id, { stripe_customer_id: sc.id });
  return sc.id;
}

async function provisionCustomerPhone(customerId) {
  const check = canProvisionNumber(db, customerId);
  if (!check.allowed) {
    console.log(`[VoiceBilling] Skip provision: ${check.reason}`);
    return null;
  }
  const customer = db.getCustomer(customerId);
  const twilio = new TwilioPhoneService();
  if (!twilio.isAvailable()) {
    console.warn('[VoiceBilling] Twilio not configured');
    return null;
  }
  const webhookUrl = `${apiBaseUrl()}/voice/incoming?customer_id=${customerId}`;
  let areaCode = null;
  if (customer.phone_number) {
    const digitsOnly = String(customer.phone_number).replace(/\D/g, '');
    if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) areaCode = digitsOnly.substring(1, 4);
    else if (digitsOnly.length === 10) areaCode = digitsOnly.substring(0, 3);
  }
  const provisioned = await twilio.provisionPhoneNumberForCustomer({
    customerId,
    areaCode,
    webhookUrl
  });
  db.updateCustomer(customerId, {
    twilio_phone_number: provisioned.phoneNumber,
    twilio_phone_sid: provisioned.sid
  });
  console.log(`[VoiceBilling] Provisioned ${provisioned.phoneNumber} for ${customerId}`);
  return provisioned;
}

async function handleInvoicePaid(invoice) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return { handled: false };

  let customerId = invoice.metadata?.customer_id
    || invoice.subscription_details?.metadata?.customer_id;
  if (!customerId && typeof subscriptionId === 'string') {
    try {
      const sub = await getStripe().subscriptions.retrieve(subscriptionId);
      customerId = sub.metadata?.customer_id;
    } catch (e) {
      console.warn('[VoiceBilling] subscription retrieve failed:', e.message);
    }
  }
  if (!customerId && invoice.customer) {
    customerId = db.db.prepare('SELECT id FROM customers WHERE stripe_customer_id = ?').get(invoice.customer)?.id;
  }

  if (!customerId) {
    console.warn('[VoiceBilling] invoice.paid without customer_id');
    return { handled: false };
  }

  const tierId = invoice.metadata?.plan_tier || db.getCustomer(customerId)?.plan_tier || 'starter';
  const tier = getTier(tierId);
  const periodEnd = invoice.lines?.data?.[0]?.period?.end
    ? new Date(invoice.lines.data[0].period.end * 1000).toISOString()
    : null;

  db.updateCustomerSubscriptionFields(customerId, {
    stripe_subscription_id: subscriptionId,
    subscription_status: 'active',
    plan_tier: tier.id,
    past_due_since: null,
    included_minutes_per_cycle: tier.included_minutes_per_cycle,
    cycle_reset_at: periodEnd
  });

  db.grantSubscriptionCycleMinutes(customerId, tier.included_minutes_per_cycle, periodEnd);
  try {
    const { convertTrialToPaid } = require('./trial-lifecycle');
    convertTrialToPaid(db, customerId);
  } catch (e) {
    console.warn('[VoiceBilling] convertTrialToPaid:', e.message);
  }
  try {
    await provisionCustomerPhone(customerId);
  } catch (e) {
    console.warn('[VoiceBilling] Provision after invoice.paid failed (non-fatal):', e.message);
  }

  return { handled: true, customerId, tier: tier.id };
}

function mapStripeSubscriptionStatus(stripeStatus) {
  if (stripeStatus === 'active' || stripeStatus === 'trialing') return 'active';
  if (stripeStatus === 'past_due') return 'past_due';
  if (stripeStatus === 'canceled' || stripeStatus === 'unpaid') return 'canceled';
  return stripeStatus;
}

async function handleSubscriptionUpdated(subscription) {
  const customerId = subscription.metadata?.customer_id
    || (subscription.customer && db.db.prepare('SELECT id FROM customers WHERE stripe_customer_id = ?').get(subscription.customer)?.id);
  if (!customerId) return { handled: false };

  const status = mapStripeSubscriptionStatus(subscription.status);
  const fields = {
    stripe_subscription_id: subscription.id,
    subscription_status: status
  };

  if (status === 'past_due') {
    const customer = db.getCustomer(customerId);
    if (!customer.past_due_since) fields.past_due_since = new Date().toISOString();
  } else if (status === 'active') {
    fields.past_due_since = null;
  } else if (status === 'canceled') {
    fields.canceled_at = new Date().toISOString();
    const { getNumberRetentionDays } = require('./billing-access');
    const retainUntil = new Date();
    retainUntil.setDate(retainUntil.getDate() + getNumberRetentionDays());
    fields.number_retention_until = retainUntil.toISOString();
    try {
      const RetellService = require('./retell-service');
      const customer = db.getCustomer(customerId);
      if (customer.retell_agent_id) {
        await new RetellService().applyAgentSettings({
          agentId: customer.retell_agent_id,
          enabled: false
        });
      }
    } catch (e) {
      console.warn('[VoiceBilling] Retell pause failed:', e.message);
    }
  }

  db.updateCustomerSubscriptionFields(customerId, fields);
  return { handled: true, customerId, status };
}

async function handleCheckoutSessionCompleted(session) {
  const customerId = session.metadata?.customer_id;
  if (!customerId) return { handled: false };

  if (session.mode === 'subscription' && session.subscription) {
    db.updateCustomerSubscriptionFields(customerId, {
      stripe_subscription_id: session.subscription,
      subscription_status: 'active',
      plan_tier: session.metadata?.plan_tier || 'starter'
    });
    try {
      const { convertTrialToPaid } = require('./trial-lifecycle');
      convertTrialToPaid(db, customerId);
    } catch (_) { /* non-fatal */ }
    return { handled: true, type: 'subscription_checkout' };
  }

  if (session.mode === 'payment' && session.metadata?.type === 'voice_topup') {
    const packId = session.metadata.pack_id;
    const pack = getTopupPack(packId);
    const minutes = pack ? pack.minutes : parseInt(session.metadata.minutes || '0', 10);
    if (minutes > 0) {
      db.addTopupMinutes(customerId, minutes);
      console.log(`[VoiceBilling] Top-up ${minutes} min for ${customerId}`);
    }
    return { handled: true, type: 'topup', minutes };
  }

  return { handled: false };
}

async function handleVoiceBillingStripeEvent(event) {
  switch (event.type) {
    case 'invoice.paid':
      return handleInvoicePaid(event.data.object);
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return handleSubscriptionUpdated(event.data.object);
    case 'checkout.session.completed':
      return handleCheckoutSessionCompleted(event.data.object);
    default:
      return { handled: false };
  }
}

async function createSubscriptionCheckout(customerId, tierId, vertical = 'general') {
  const customer = db.getCustomer(customerId);
  if (!customer) throw new Error('Customer not found');
  const priceId = priceIdForTier(tierId);
  if (!priceId) throw new Error(`Stripe price not configured for tier ${tierId}`);

  const stripeCustomerId = await ensureStripeCustomer(customer);
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: stripeCustomerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${portalBaseUrl()}/business/settings.html?billing=success`,
    cancel_url: `${portalBaseUrl()}/business/settings.html?billing=cancelled`,
    metadata: {
      customer_id: customerId,
      plan_tier: tierId,
      billing_vertical: vertical
    },
    subscription_data: {
      metadata: {
        customer_id: customerId,
        plan_tier: tierId
      }
    }
  });

  db.updateCustomer(customerId, { plan_tier: tierId, billing_vertical: vertical });
  return { url: session.url, session_id: session.id };
}

async function createTopupCheckout(customerId, packId) {
  const customer = db.getCustomer(customerId);
  if (!customer) throw new Error('Customer not found');
  const pack = getTopupPack(packId);
  if (!pack) throw new Error('Invalid top-up pack');
  const priceId = priceIdForTopup(packId);
  if (!priceId) throw new Error(`Stripe price not configured for pack ${packId}`);

  const stripeCustomerId = await ensureStripeCustomer(customer);
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: stripeCustomerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${portalBaseUrl()}/business/settings.html?topup=success`,
    cancel_url: `${portalBaseUrl()}/business/settings.html?topup=cancelled`,
    metadata: {
      customer_id: customerId,
      type: 'voice_topup',
      pack_id: packId,
      minutes: String(pack.minutes)
    }
  });
  return { url: session.url, session_id: session.id, pack };
}

function getBillingStatus(customerId) {
  const customer = db.getCustomer(customerId);
  if (!customer) return null;
  const pools = db.getBillingMinutePools(customerId);
  const tier = getTier(customer.plan_tier);
  const { getLowBalanceThresholdMinutes } = require('./apply-usage');
  const threshold = getLowBalanceThresholdMinutes(db, customer);
  const {
    isTrialSimEnabledForCustomer,
    getTrialMinutesAllocated,
    getTrialMinutesRemaining,
    isSomoDemoSignup
  } = require('./trial-lifecycle');

  let trialDaysLeft = null;
  if (customer.trial_expires_at) {
    trialDaysLeft = Math.max(
      0,
      Math.ceil((new Date(customer.trial_expires_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    );
  }

  const simTrial = isTrialSimEnabledForCustomer(customer);
  const trialMinutesAllocated = simTrial ? getTrialMinutesAllocated() : null;
  const trialMinutesRemaining = simTrial ? getTrialMinutesRemaining(db, customer) : null;

  return {
    plan_tier: customer.plan_tier,
    subscription_status: customer.subscription_status,
    cycle_reset_at: customer.cycle_reset_at,
    included_minutes_per_cycle: customer.included_minutes_per_cycle || tier.included_minutes_per_cycle,
    minutes_remaining: pools.total_available,
    topup_balance_minutes: pools.topup_balance_minutes,
    low_balance_threshold: threshold,
    twilio_phone_number: customer.twilio_phone_number,
    billing_enforcement_paused: customer.billing_enforcement_paused === 1,
    trial_status: customer.trial_status || 'none',
    trial_expires_at: customer.trial_expires_at,
    trial_days_left: trialDaysLeft,
    trial_minutes_allocated: trialMinutesAllocated,
    trial_minutes_remaining: trialMinutesRemaining,
    phone_verified: customer.phone_verified === 1,
    is_somo_demo_signup: isSomoDemoSignup(customer),
    sim_trial_enabled: simTrial,
    trial_welcome_dismissed: !!customer.trial_welcome_dismissed_at
  };
}

module.exports = {
  handleVoiceBillingStripeEvent,
  createSubscriptionCheckout,
  createTopupCheckout,
  provisionCustomerPhone,
  getBillingStatus,
  priceIdForTier,
  priceIdForTopup,
  ensureStripeCustomer
};
