/**
 * Authentication Middleware
 * Protects API endpoints with API key authentication
 */

const db = require('../database');
const { generateApiKey: createApiKey, hashApiKey } = require('../utils/api-keys');

/**
 * Generate API key for merchant
 */
function generateApiKey() {
  return createApiKey('sk');
}

/**
 * Verify API key from request
 */
function verifyApiKey(req, res, next) {
  // Skip auth for public endpoints
  const publicPaths = [
    '/health',
    '/',
    '/voice/incoming', // Retell webhook
    '/webhook/stripe', // Stripe webhook
    '/webhook/circle', // Circle webhook
    '/payment/', // Public payment pages
    '/api/patient/verify/', // Patient verification
  ];

  if (publicPaths.some(path => req.path.startsWith(path))) {
    return next();
  }

  // Get API key from header or query
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '') || req.query.api_key;

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: 'API key required',
      message: 'Please provide an API key in X-API-Key header or Authorization header'
    });
  }

  // Verify API key exists in database
  const hashedKey = hashApiKey(apiKey);
  
  // Check merchant API keys first
  const merchantKeyRecord = db.getActiveMerchantApiKeyByHash(hashedKey);
  if (merchantKeyRecord) {
    const merchant = db.getMerchant(merchantKeyRecord.merchant_id);
    if (!merchant) {
      return res.status(401).json({
        success: false,
        error: 'Merchant not found for API key'
      });
    }

    req.merchant = merchant;
    req.api_key_id = merchantKeyRecord.id;
    req.customer_id = null; // Merchant key, not customer key
    db.markMerchantApiKeyUsed(merchantKeyRecord.id);
    return next();
  }

  // Check customer API keys
  const customerKeyRecord = db.getAPIKeyByHash(hashedKey);
  if (customerKeyRecord) {
    const customer = db.getCustomer(customerKeyRecord.customer_id);
    if (!customer || !customer.email_verified || customer.status !== 'active') {
      return res.status(401).json({
        success: false,
        error: 'Invalid or inactive customer API key',
        message: 'The provided API key is not valid or the account is not active'
      });
    }

    // Check terms acceptance
    const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
    if (!termsAccepted) {
      return res.status(403).json({
        success: false,
        error: 'Terms not accepted',
        message: 'Please accept the terms of service before using the API'
      });
    }

    req.customer = customer;
    req.customer_id = customer.id;
    req.api_key_id = customerKeyRecord.id;
    req.merchant = null; // Customer key, not merchant key
    
    // Update last used
    db.updateAPIKeyLastUsed(customerKeyRecord.id);
    
    // Create or get merchant record for customer (for compatibility)
    // Customers become merchants for API compatibility
    if (!req.merchant) {
      const merchantId = customer.id; // Use customer ID as merchant ID
      let merchant = db.getMerchant(merchantId);
      if (!merchant) {
        // Create merchant record for customer
        db.createMerchant({
          id: merchantId,
          name: customer.name || customer.company_name || 'Customer',
          api_key: apiKey, // Store original key for backward compatibility
          api_url: process.env.API_BASE_URL || 'https://api.doclittle.site',
          enabled_platforms: ['voice'],
          status: 'active'
        });
        merchant = db.getMerchant(merchantId);
      }
      req.merchant = merchant;
    }
    
    return next();
  }

  // Legacy merchant API key check (direct match)
  const merchant = db.getMerchantByApiKey(apiKey);
  if (!merchant) {
    return res.status(401).json({
      success: false,
      error: 'Invalid API key',
      message: 'The provided API key is not valid'
    });
  }

  req.merchant = merchant;
  req.customer_id = null;
  next();
}

/**
 * Optional API key verification (for endpoints that work with or without auth)
 */
function optionalApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '') || req.query.api_key;

  if (apiKey) {
    const hashedKey = hashApiKey(apiKey);
    const merchantKeyRecord = db.getActiveMerchantApiKeyByHash(hashedKey);
    if (merchantKeyRecord) {
      const merchant = db.getMerchant(merchantKeyRecord.merchant_id);
      if (merchant) {
        req.merchant = merchant;
        req.api_key_id = merchantKeyRecord.id;
      }
    } else {
    const merchant = db.getMerchantByApiKey(apiKey);
    if (merchant) {
      req.merchant = merchant;
      }
    }
  }

  next();
}

module.exports = {
  generateApiKey,
  verifyApiKey,
  optionalApiKey
};

