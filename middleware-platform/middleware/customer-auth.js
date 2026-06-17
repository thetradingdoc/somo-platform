/**
 * CUSTOMER AUTHENTICATION MIDDLEWARE
 * Protects routes that require customer authentication
 * Attaches customer and merchant_id/provider_id to request object
 */

const db = require('../database');

/**
 * Parse cookies from request
 */
function parseCookies(req) {
  const header = req.headers?.cookie;
  if (!header) return {};
  return header.split(';').reduce((acc, chunk) => {
    const [key, value] = chunk.split('=');
    if (key && value) {
      acc[key.trim()] = decodeURIComponent(value.trim());
    }
    return acc;
  }, {});
}

/**
 * Require customer authentication middleware
 * Checks for customer_session cookie, validates session, and attaches customer/merchant to request
 */
function requireCustomerAuth(req, res, next) {
  try {
    // Get session ID from cookie
    const cookies = parseCookies(req);
    const sessionId = cookies.customer_session;

    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'Please sign in to access this resource'
      });
    }

    // Validate session
    const session = db.getCustomerSession(sessionId);
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session',
        message: 'Your session has expired. Please sign in again.'
      });
    }

    // Get customer
    const customer = db.getCustomer(session.customer_id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found',
        message: 'Your account could not be found. Please contact support.'
      });
    }

    // Check if email is verified
    if (!customer.email_verified) {
      return res.status(403).json({
        success: false,
        error: 'Email not verified',
        message: 'Please verify your email address before accessing this resource.'
      });
    }

    // Check if terms are accepted
    const termsAccepted = db.hasAcceptedTerms(customer.id, '1.0');
    if (!termsAccepted) {
      return res.status(403).json({
        success: false,
        error: 'Terms not accepted',
        message: 'Please accept the terms of service before accessing this resource.'
      });
    }

    // W2-05: SaaS tenants must have merchant_id after onboarding (email + terms)
    const onboardingComplete = customer.email_verified && termsAccepted;
    if (
      customer.customer_type === 'saas' &&
      onboardingComplete &&
      (!customer.merchant_id || String(customer.merchant_id).trim() === '')
    ) {
      return res.status(403).json({
        success: false,
        error: 'merchant_required',
        message: 'Account setup is incomplete. Contact support or complete signup.'
      });
    }

    // Get merchant if customer has one
    let merchant = null;
    if (customer.merchant_id) {
      merchant = db.getMerchant(customer.merchant_id);
      if (!merchant) {
        console.warn(`⚠️  Customer ${customer.id} has merchant_id ${customer.merchant_id} but merchant not found`);
      }
    }

    // Attach to request object
    req.customer = customer;
    req.merchant = merchant;
    req.provider = merchant;
    req.merchant_id = customer.merchant_id; // Legacy naming
    req.provider_id = customer.merchant_id; // Preferred naming alias
    req.session = session;

    if (!customer._capabilities) {
      try {
        const { getCapabilities } = require('../services/customer-capabilities');
        customer._capabilities = getCapabilities(customer);
      } catch (_) {
        customer._capabilities = [];
      }
    }

    // Continue to next middleware/route
    next();
  } catch (error) {
    console.error('❌ Customer auth middleware error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication error',
      message: 'An error occurred during authentication. Please try again.'
    });
  }
}

/**
 * Optional customer authentication middleware
 * Attaches customer if session exists, but doesn't require it
 * Useful for routes that work for both authenticated and anonymous users
 */
function optionalCustomerAuth(req, res, next) {
  try {
    const cookies = parseCookies(req);
    const sessionId = cookies.customer_session;

    if (sessionId) {
      const session = db.getCustomerSession(sessionId);
      if (session) {
        const customer = db.getCustomer(session.customer_id);
        if (customer && customer.email_verified) {
          req.customer = customer;
          req.merchant_id = customer.merchant_id;
          req.provider_id = customer.merchant_id;
          if (customer.merchant_id) {
            req.merchant = db.getMerchant(customer.merchant_id);
            req.provider = req.merchant;
          }
          req.session = session;
        }
      }
    }

    next();
  } catch (error) {
    // Don't fail on optional auth errors, just continue
    console.warn('⚠️  Optional customer auth error:', error.message);
    next();
  }
}

/**
 * Require merchant association
 * Must be used after requireCustomerAuth
 * Ensures customer has a merchant_id
 */
function requireMerchant(req, res, next) {
  if (!req.merchant_id) {
    return res.status(400).json({
      success: false,
      error: 'No merchant associated',
      message: 'Your account is not associated with a merchant. Please complete onboarding or contact support.'
    });
  }

  if (!req.merchant) {
    return res.status(404).json({
      success: false,
      error: 'Merchant not found',
      message: 'Your merchant account could not be found. Please contact support.'
    });
  }

  next();
}

module.exports = {
  requireCustomerAuth,
  optionalCustomerAuth,
  requireMerchant
};

