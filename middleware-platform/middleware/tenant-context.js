/**
 * Tenant Context Middleware
 * Extracts and validates tenant information from requests
 * 
 * This middleware should be used BEFORE routes that need tenant context.
 * It populates req.tenant with validated tenant information.
 */

const db = require('../database');
const constants = require('../utils/constants');

/**
 * Extract tenant from request using multiple methods
 * Note: Some database calls are async, so this returns a Promise
 */
async function extractTenantFromRequest(req) {
  const tenant = {
    clinic_id: null,
    merchant_id: null,
    provider_id: null,
    clinic: null,
    merchant: null,
    provider: null,
    method: null,
    validated: false
  };

  // Method 1: Explicit clinic_id in request body/query/params
  const clinicId = req.body?.clinic_id || req.query?.clinic_id || req.params?.clinic_id;
  if (clinicId) {
    const clinic = await db.getClinicById(clinicId);
    if (clinic && clinic.is_active) {
      tenant.clinic_id = clinicId;
      tenant.clinic = clinic;
      tenant.method = constants.TENANTS.RESOLUTION_METHODS.CLINIC_ID;
      tenant.validated = true;
      return tenant;
    }
  }

  // Method 2: Explicit merchant_id in request body/query/params
  const merchantId = req.body?.provider_id || req.query?.provider_id || req.params?.provider_id ||
    req.body?.merchant_id || req.query?.merchant_id || req.params?.merchant_id;
  if (merchantId) {
    const merchant = db.getMerchant(merchantId);
    if (merchant) {
      tenant.merchant_id = merchantId;
      tenant.provider_id = merchantId;
      tenant.merchant = merchant;
      tenant.provider = merchant;
      tenant.method = constants.TENANTS.RESOLUTION_METHODS.MERCHANT_ID;
      
      // Try to find associated clinic
      if (merchant.subdomain) {
        const clinic = await db.getClinicBySlug(merchant.subdomain);
        if (clinic) {
          tenant.clinic_id = clinic.clinic_id;
          tenant.clinic = clinic;
        }
      }
      
      tenant.validated = true;
      return tenant;
    }
  }

  // Method 3: Subdomain from hostname
  const hostname = req.headers.host?.split(':')[0] || req.headers.host;
  if (hostname) {
    const subdomain = extractSubdomain(hostname);
    if (subdomain && subdomain !== 'api' && subdomain !== 'www') {
      // Try clinic first (by slug)
      const clinic = await db.getClinicBySlug(subdomain);
      if (clinic && clinic.is_active) {
        tenant.clinic_id = clinic.clinic_id;
        tenant.clinic = clinic;
        tenant.method = constants.TENANTS.RESOLUTION_METHODS.SUBDOMAIN;
        tenant.validated = true;
        return tenant;
      }
      
      // Fallback to merchant (by subdomain)
      const merchant = db.getMerchantBySubdomain(subdomain);
      if (merchant) {
        tenant.merchant_id = merchant.id;
        tenant.provider_id = merchant.id;
        tenant.merchant = merchant;
        tenant.provider = merchant;
        tenant.method = constants.TENANTS.RESOLUTION_METHODS.SUBDOMAIN;
        tenant.validated = true;
        return tenant;
      }
    }
  }

  // Method 3b: Subdomain from Origin or Referer header (for API calls from tenant subdomains)
  // When frontend calls api.callsomo.com, the Origin header contains the tenant subdomain
  const origin = req.headers.origin || req.headers.referer;
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const originSubdomain = extractSubdomain(originUrl.hostname);
      if (originSubdomain && originSubdomain !== 'api' && originSubdomain !== 'www') {
        // Try clinic first (by slug)
        const clinic = await db.getClinicBySlug(originSubdomain);
        if (clinic && clinic.is_active) {
          tenant.clinic_id = clinic.clinic_id;
          tenant.clinic = clinic;
          tenant.method = constants.TENANTS.RESOLUTION_METHODS.SUBDOMAIN;
          tenant.validated = true;
          return tenant;
        }
        
        // Fallback to merchant (by subdomain)
        const merchant = db.getMerchantBySubdomain(originSubdomain);
        if (merchant) {
          tenant.merchant_id = merchant.id;
          tenant.provider_id = merchant.id;
          tenant.merchant = merchant;
          tenant.provider = merchant;
          tenant.method = constants.TENANTS.RESOLUTION_METHODS.SUBDOMAIN;
          tenant.validated = true;
          return tenant;
        }
      }
    } catch (e) {
      // Invalid URL in Origin/Referer, continue to next method
    }
  }

  // Method 4: Phone number (for voice calls)
  const phoneNumber = req.body?.To || req.body?.to_number || req.body?.phone_number;
  if (phoneNumber) {
    const clinicPhone = db.getClinicPhoneNumber(phoneNumber);
    if (clinicPhone) {
      const clinic = await db.getClinicById(clinicPhone.clinic_id);
      if (clinic && clinic.is_active) {
        tenant.clinic_id = clinic.clinic_id;
        tenant.clinic = clinic;
        tenant.method = constants.TENANTS.RESOLUTION_METHODS.PHONE_NUMBER;
        tenant.validated = true;
        return tenant;
      }
    }
  }

  // Method 5: Session-based tenant resolution (for authenticated users)
  // When API calls come from api.callsomo.com, check user session for merchant_id
  const sessionId = req.cookies?.customer_session;
  if (sessionId) {
    const session = db.getCustomerSession(sessionId);
    if (session) {
      const customer = db.getCustomer(session.customer_id);
      if (customer && customer.merchant_id) {
        const merchant = db.getMerchant(customer.merchant_id);
        if (merchant) {
          tenant.merchant_id = merchant.id;
          tenant.provider_id = merchant.id;
          tenant.merchant = merchant;
          tenant.provider = merchant;
          tenant.method = 'session';
          
          // Try to find associated clinic
          if (merchant.subdomain) {
            const clinic = await db.getClinicBySlug(merchant.subdomain);
            if (clinic) {
              tenant.clinic_id = clinic.clinic_id;
              tenant.clinic = clinic;
            }
          }
          
          tenant.validated = true;
          return tenant;
        }
      }
    }
  }

  // No tenant found
  return tenant;
}

/**
 * Extract subdomain from hostname
 */
function extractSubdomain(hostname) {
  if (!hostname) return null;

  const host = hostname.split(':')[0];
  const parts = host.split('.');

  // For localhost, no subdomain
  if (host === 'localhost' || host === '127.0.0.1') {
    return null;
  }

  // For known domains, extract subdomain
  if (parts.length >= 3) {
    const knownDomains = ['callsomo.com'];
    const domain = parts.slice(-2).join('.');

    if (knownDomains.includes(domain)) {
      return parts[0];
    }
  }

  return null;
}

/**
 * Tenant Context Middleware
 * 
 * Usage:
 *   app.use('/api/voice', tenantContext(), voiceRoutes);
 *   app.use('/api/payment', requireTenant, paymentRoutes);
 * 
 * Options:
 *   - requireTenant: If true, returns 400 if tenant not found
 *   - allowFallback: If true, allows fallback to default tenant (NOT RECOMMENDED - only for backward compatibility)
 */
function tenantContext(options = {}) {
  const { requireTenant = false, allowFallback = false } = options;

  return async (req, res, next) => {
    try {
      // Extract tenant from request (async)
      const tenant = await extractTenantFromRequest(req);

      // If tenant not found and fallback is allowed (NOT RECOMMENDED - only for backward compatibility)
      if (!tenant.validated && allowFallback) {
        console.warn('⚠️  Tenant not found, using fallback (NOT RECOMMENDED - backward compatibility only)');
        const defaultSubdomain = constants.TENANTS.DEFAULT_SUBDOMAIN;
        const fallbackMerchant = db.getMerchantBySubdomain(defaultSubdomain);
        
        if (fallbackMerchant) {
          tenant.merchant_id = fallbackMerchant.id;
          tenant.provider_id = fallbackMerchant.id;
          tenant.merchant = fallbackMerchant;
          tenant.provider = fallbackMerchant;
          tenant.method = 'fallback';
          tenant.validated = true;
          console.warn(`⚠️  Using fallback tenant: ${defaultSubdomain} (backward compatibility)`);
        }
      }

      // Attach tenant to request
      req.tenant = tenant;

      // If tenant is required but not found, return error
      if (requireTenant && !tenant.validated) {
        return res.status(400).json({
          success: false,
          error: 'Tenant not found',
          message: 'Could not determine tenant from request. Please provide clinic_id, provider_id/merchant_id, subdomain, or phone number.',
          details: {
            provided: {
              clinic_id: req.body?.clinic_id || req.query?.clinic_id || req.params?.clinic_id || null,
              provider_id: req.body?.provider_id || req.query?.provider_id || req.params?.provider_id || null,
              merchant_id: req.body?.merchant_id || req.query?.merchant_id || req.params?.merchant_id || null,
              subdomain: extractSubdomain(req.headers.host),
              phone_number: req.body?.To || req.body?.to_number || req.body?.phone_number || null
            }
          }
        });
      }

      // Log tenant resolution (only in development)
      if (process.env.NODE_ENV !== 'production' && tenant.validated) {
        console.log(`✅ Tenant resolved: ${tenant.method} → ${tenant.clinic_id || tenant.merchant_id}`);
      }

      next();
    } catch (error) {
      console.error('❌ Error in tenant context middleware:', error);
      // Don't block request if tenant resolution fails (for backward compatibility)
      req.tenant = {
        clinic_id: null,
        merchant_id: null,
        provider_id: null,
        clinic: null,
        merchant: null,
        provider: null,
        method: null,
        validated: false
      };
      next();
    }
  };
}

/**
 * Require tenant middleware (shorthand for requireTenant: true)
 */
function requireTenant() {
  return tenantContext({ requireTenant: true });
}

module.exports = {
  tenantContext,
  requireTenant,
  extractTenantFromRequest,
  extractSubdomain
};

