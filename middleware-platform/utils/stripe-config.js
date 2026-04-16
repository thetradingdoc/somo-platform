/**
 * Stripe Configuration Utility
 * 
 * Centralized Stripe configuration with environment-aware key selection
 * and validation to prevent security issues (production keys in dev, test keys in prod)
 */
const SecretManager = require('../services/secret-manager');

/**
 * Get Stripe secret key with validation
 * @returns {string} Stripe secret key
 * @throws {Error} If key is missing or invalid
 */
function getStripeSecretKey() {
  const key = SecretManager.getSecret('STRIPE_SECRET_KEY', {
    consumer: 'stripe-config',
    purpose: 'stripe_secret_key'
  });
  
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY environment variable is required');
  }
  
  const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
  const isLiveKey = key.startsWith('sk_live_');
  const isTestKey = key.startsWith('sk_test_');
  
  // Validation: Prevent using production keys in development
  if (isProduction && isTestKey) {
    throw new Error(
      'SECURITY ERROR: Test Stripe key detected in production environment! ' +
      'Please use production keys (sk_live_...) in production.'
    );
  }
  
  // Allow live keys in dev if explicitly enabled via ALLOW_LIVE_KEYS_IN_DEV
  if (!isProduction && isLiveKey && !process.env.ALLOW_LIVE_KEYS_IN_DEV) {
    throw new Error(
      'SECURITY ERROR: Production Stripe key detected in development environment! ' +
      'Please use test keys (sk_test_...) in development or set ALLOW_LIVE_KEYS_IN_DEV=true'
    );
  }
  
  // Validate key format
  if (!isLiveKey && !isTestKey) {
    throw new Error(
      'Invalid Stripe secret key format. ' +
      'Key must start with sk_live_ (production) or sk_test_ (test)'
    );
  }
  
  return key;
}

/**
 * Get Stripe publishable key with validation
 * @returns {string} Stripe publishable key
 * @throws {Error} If key is missing or invalid
 */
function getStripePublishableKey() {
  const key = SecretManager.getSecret('STRIPE_PUBLISHABLE_KEY', {
    consumer: 'stripe-config',
    purpose: 'stripe_publishable_key'
  });
  
  if (!key) {
    throw new Error('STRIPE_PUBLISHABLE_KEY environment variable is required');
  }
  
  const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
  const isLiveKey = key.startsWith('pk_live_');
  const isTestKey = key.startsWith('pk_test_');
  
  // Validation: Prevent using production keys in development
  if (isProduction && isTestKey) {
    throw new Error(
      'SECURITY ERROR: Test Stripe publishable key detected in production environment! ' +
      'Please use production keys (pk_live_...) in production.'
    );
  }
  
  // Allow live keys in dev if explicitly enabled via ALLOW_LIVE_KEYS_IN_DEV
  if (!isProduction && isLiveKey && !process.env.ALLOW_LIVE_KEYS_IN_DEV) {
    throw new Error(
      'SECURITY ERROR: Production Stripe publishable key detected in development environment! ' +
      'Please use test keys (pk_test_...) in development or set ALLOW_LIVE_KEYS_IN_DEV=true'
    );
  }
  
  // Validate key format
  if (!isLiveKey && !isTestKey) {
    throw new Error(
      'Invalid Stripe publishable key format. ' +
      'Key must start with pk_live_ (production) or pk_test_ (test)'
    );
  }
  
  return key;
}

/**
 * Initialize Stripe instance with proper configuration
 * @returns {object|null} Stripe instance or null if not configured
 */
function initializeStripe() {
  try {
    const secretKey = getStripeSecretKey();
    const isProduction = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
    const isLiveKey = secretKey.startsWith('sk_live_');
    
    const stripe = require('stripe')(secretKey);
    console.log(`✅ Stripe initialized: ${isLiveKey ? 'PRODUCTION' : 'TEST'} mode`);
    
    return stripe;
  } catch (error) {
    if (error.message.includes('environment variable is required')) {
      console.warn('⚠️  Stripe not configured - Payment features will be disabled');
      return null;
    }
    // For validation errors, throw them (they're security issues)
    console.error('❌ Stripe configuration error:', error.message);
    throw error;
  }
}

/**
 * Check if Stripe is properly configured
 * @returns {boolean} True if Stripe is configured
 */
function isStripeConfigured() {
  try {
    getStripeSecretKey();
    getStripePublishableKey();
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get current Stripe mode (production or test)
 * @returns {string} 'production' or 'test'
 */
function getStripeMode() {
  try {
    const key = getStripeSecretKey();
    return key.startsWith('sk_live_') ? 'production' : 'test';
  } catch (error) {
    return 'not_configured';
  }
}

module.exports = {
  getStripeSecretKey,
  getStripePublishableKey,
  initializeStripe,
  isStripeConfigured,
  getStripeMode
};

