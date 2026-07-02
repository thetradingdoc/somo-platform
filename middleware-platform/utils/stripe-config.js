/**
 * Stripe configuration — single source of truth for test vs live billing mode.
 *
 * STRIPE_BILLING_MODE=test|live (default test)
 * test → STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_PRICE_*, STRIPE_WEBHOOK_SECRET
 * live → STRIPE_LIVE_SECRET_KEY, STRIPE_LIVE_PUBLISHABLE_KEY, STRIPE_LIVE_PRICE_*, STRIPE_LIVE_WEBHOOK_SECRET
 */
const SecretManager = require('../services/secret-manager');

const TIER_PRICE_ENV = {
  test: {
    starter: 'STRIPE_PRICE_STARTER',
    practice: 'STRIPE_PRICE_PRACTICE',
    clinic_pro: 'STRIPE_PRICE_CLINIC_PRO'
  },
  live: {
    starter: 'STRIPE_LIVE_PRICE_STARTER',
    practice: 'STRIPE_LIVE_PRICE_PRACTICE',
    clinic_pro: 'STRIPE_LIVE_PRICE_CLINIC_PRO'
  }
};

const TOPUP_PRICE_ENV = {
  test: {
    small: 'STRIPE_PRICE_TOPUP_SMALL',
    standard: 'STRIPE_PRICE_TOPUP_STANDARD',
    large: 'STRIPE_PRICE_TOPUP_LARGE'
  },
  live: {
    small: 'STRIPE_LIVE_PRICE_TOPUP_SMALL',
    standard: 'STRIPE_LIVE_PRICE_TOPUP_STANDARD',
    large: 'STRIPE_LIVE_PRICE_TOPUP_LARGE'
  }
};

function normalizeBillingMode(mode) {
  const m = String(mode || process.env.STRIPE_BILLING_MODE || 'test').toLowerCase();
  return m === 'live' ? 'live' : 'test';
}

function getStripeBillingMode() {
  return normalizeBillingMode();
}

function allowTestInProduction() {
  return (
    process.env.STAGING === '1' ||
    process.env.SOMO_STAGING === '1' ||
    process.env.ALLOW_STRIPE_TEST_IN_PRODUCTION === '1'
  );
}

function isNodeProduction() {
  return process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
}

function validateSecretKey(key, billingMode) {
  const isLiveKey = key.startsWith('sk_live_');
  const isTestKey = key.startsWith('sk_test_');

  if (billingMode === 'live' && isTestKey) {
    throw new Error('STRIPE_BILLING_MODE=live requires sk_live_ secret key');
  }
  if (billingMode === 'test' && isLiveKey && !process.env.ALLOW_LIVE_KEYS_IN_DEV) {
    throw new Error('Test billing mode requires sk_test_ secret key');
  }
  if (isNodeProduction() && billingMode === 'test' && isTestKey && !allowTestInProduction()) {
    throw new Error(
      'SECURITY ERROR: Test Stripe key in production without ALLOW_STRIPE_TEST_IN_PRODUCTION'
    );
  }
  if (!isNodeProduction() && isLiveKey && billingMode === 'test' && !process.env.ALLOW_LIVE_KEYS_IN_DEV) {
    throw new Error(
      'SECURITY ERROR: Live Stripe key in development test mode. Set ALLOW_LIVE_KEYS_IN_DEV=true or use test keys'
    );
  }
  if (!isLiveKey && !isTestKey) {
    throw new Error('Invalid Stripe secret key format (sk_test_ or sk_live_)');
  }
}

function validatePublishableKey(key, billingMode) {
  const isLiveKey = key.startsWith('pk_live_');
  const isTestKey = key.startsWith('pk_test_');

  if (billingMode === 'live' && isTestKey) {
    throw new Error('STRIPE_BILLING_MODE=live requires pk_live_ publishable key');
  }
  if (billingMode === 'test' && isLiveKey && !process.env.ALLOW_LIVE_KEYS_IN_DEV) {
    throw new Error('Test billing mode requires pk_test_ publishable key');
  }
  if (isNodeProduction() && billingMode === 'test' && isTestKey && !allowTestInProduction()) {
    throw new Error(
      'SECURITY ERROR: Test Stripe publishable key in production without ALLOW_STRIPE_TEST_IN_PRODUCTION'
    );
  }
  if (!isLiveKey && !isTestKey) {
    throw new Error('Invalid Stripe publishable key format (pk_test_ or pk_live_)');
  }
}

/**
 * @param {{ billingMode?: 'test'|'live' }} [opts]
 */
function getStripeSecretKey(opts = {}) {
  const billingMode = normalizeBillingMode(opts.billingMode);
  const envKey = billingMode === 'live' ? 'STRIPE_LIVE_SECRET_KEY' : 'STRIPE_SECRET_KEY';
  const key = SecretManager.getSecret(envKey, {
    consumer: 'stripe-config',
    purpose: 'stripe_secret_key'
  });
  if (!key) {
    throw new Error(`${envKey} environment variable is required`);
  }
  validateSecretKey(key, billingMode);
  return key;
}

/**
 * @param {{ billingMode?: 'test'|'live' }} [opts]
 */
function getStripePublishableKey(opts = {}) {
  const billingMode = normalizeBillingMode(opts.billingMode);
  const envKey = billingMode === 'live' ? 'STRIPE_LIVE_PUBLISHABLE_KEY' : 'STRIPE_PUBLISHABLE_KEY';
  const key = SecretManager.getSecret(envKey, {
    consumer: 'stripe-config',
    purpose: 'stripe_publishable_key'
  });
  if (!key) {
    throw new Error(`${envKey} environment variable is required`);
  }
  validatePublishableKey(key, billingMode);
  return key;
}

/**
 * @param {{ billingMode?: 'test'|'live' }} [opts]
 */
function getStripeWebhookSecret(opts = {}) {
  const billingMode = normalizeBillingMode(opts.billingMode);
  const envKey = billingMode === 'live' ? 'STRIPE_LIVE_WEBHOOK_SECRET' : 'STRIPE_WEBHOOK_SECRET';
  return SecretManager.getSecret(envKey, {
    consumer: 'stripe-config',
    purpose: 'stripe_webhook_secret'
  }) || null;
}

function getStripePriceId(tierOrPackId, kind = 'tier', opts = {}) {
  const billingMode = normalizeBillingMode(opts.billingMode);
  const map = kind === 'topup' ? TOPUP_PRICE_ENV[billingMode] : TIER_PRICE_ENV[billingMode];
  const envKey = map[tierOrPackId];
  if (!envKey) return null;
  const val = process.env[envKey];
  return val && String(val).trim() ? String(val).trim() : null;
}

function getStripePriceEnvKeys(billingMode = getStripeBillingMode()) {
  const mode = normalizeBillingMode(billingMode);
  return [
    ...Object.values(TIER_PRICE_ENV[mode]),
    ...Object.values(TOPUP_PRICE_ENV[mode])
  ];
}

/**
 * @param {{ billingMode?: 'test'|'live' }} [opts]
 */
function initializeStripe(opts = {}) {
  try {
    const secretKey = getStripeSecretKey(opts);
    const billingMode = normalizeBillingMode(opts.billingMode);
    const stripe = require('stripe')(secretKey);
    console.log(`✅ Stripe initialized: ${billingMode} (${secretKey.startsWith('sk_live_') ? 'live key' : 'test key'})`);
    return stripe;
  } catch (error) {
    if (error.message.includes('environment variable is required')) {
      console.warn('⚠️  Stripe not configured - Payment features will be disabled');
      return null;
    }
    console.error('❌ Stripe configuration error:', error.message);
    throw error;
  }
}

function isStripeConfigured(opts = {}) {
  try {
    getStripeSecretKey(opts);
    getStripePublishableKey(opts);
    return true;
  } catch (_) {
    return false;
  }
}

function getStripeMode(opts = {}) {
  try {
    const key = getStripeSecretKey(opts);
    return key.startsWith('sk_live_') ? 'production' : 'test';
  } catch (_) {
    return 'not_configured';
  }
}

module.exports = {
  getStripeBillingMode,
  getStripeSecretKey,
  getStripePublishableKey,
  getStripeWebhookSecret,
  getStripePriceId,
  getStripePriceEnvKeys,
  initializeStripe,
  isStripeConfigured,
  getStripeMode
};
