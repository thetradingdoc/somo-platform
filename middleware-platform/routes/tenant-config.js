/**
 * TENANT CONFIG ROUTES
 * 
 * Provides tenant configuration (tenant_type, navigation, etc.) based on subdomain
 */

const express = require('express');
const db = require('../database');
const constants = require('../utils/constants');
const { getEffectiveTenantPolicy } = require('../services/prompt-profile-templates');

const router = express.Router();

/**
 * Helper to extract subdomain from hostname
 */
function getSubdomain(hostname) {
  if (!hostname) return null;
  const host = hostname.split(':')[0];
  const parts = host.split('.');
  if (host === 'localhost' || host === '127.0.0.1') {
    return null;
  }
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
 * Helper to determine tenant type from merchant
 */
function getTenantType(merchant) {
  if (!merchant) {
    return 'clinic'; // Default
  }
  
  // Use tenant_type field if available
  if (merchant.tenant_type) {
    return merchant.tenant_type;
  }
  
  // Backward compatibility: check subdomain
  if (merchant.subdomain === constants.TENANTS.DEFAULT_SUBDOMAIN) {
    return 'shop';
  }
  
  return 'clinic'; // Default
}

/**
 * GET /api/tenant/config
 * Get tenant configuration based on subdomain or session
 */
router.get('/config', (req, res) => {
  try {
    // When frontend calls api.callsomo.com, Host is api.callsomo.com — use Origin for tenant subdomain
    const hostname = req.headers.host || req.get('host');
    let subdomain = getSubdomain(hostname);
    
    // If no subdomain from Host (e.g., api.callsomo.com), try Origin header
    if (!subdomain) {
      const origin = req.headers.origin || req.headers.referer;
      if (origin) {
        try {
          const originUrl = new URL(origin);
          subdomain = getSubdomain(originUrl.hostname);
          console.log(`🔍 Extracted subdomain from Origin header: ${subdomain} (from ${origin})`);
        } catch (e) {
          console.warn('⚠️  Could not parse Origin header:', origin);
        }
      }
    }
    
    let tenantType = 'clinic'; // Default
    let merchant = null;
    let clinic = null;
    
    // Try to find merchant by subdomain
    if (subdomain) {
      merchant = db.getMerchantBySubdomain(subdomain);
      if (merchant) {
        tenantType = getTenantType(merchant);
        console.log(`✅ Found merchant for subdomain "${subdomain}": ${merchant.name} (${merchant.id})`);
      } else {
        // Try to find clinic by slug
        clinic = db.getClinicBySlug(subdomain);
        if (clinic) {
          tenantType = 'clinic';
          console.log(`✅ Found clinic for subdomain "${subdomain}": ${clinic.clinic_id}`);
        } else {
          console.warn(`⚠️  No merchant or clinic found for subdomain: ${subdomain}`);
        }
      }
    } else {
      console.warn('⚠️  No subdomain found in Host or Origin headers');
    }
    
    // If no subdomain, try to get from session (for logged-in users)
    if (!merchant && !clinic) {
      const sessionId = req.cookies?.customer_session;
      if (sessionId) {
        const session = db.getCustomerSession(sessionId);
        if (session) {
          const customer = db.getCustomer(session.customer_id);
          if (customer && customer.merchant_id) {
            merchant = db.getMerchant(customer.merchant_id);
            if (merchant) {
              tenantType = getTenantType(merchant);
              // Resolve clinic_id from merchant (for provider calendar, appointments)
              try {
                const defaultClinicId = process.env.DEFAULT_CLINIC_ID || process.env.PRIMARY_CLINIC_ID || 'clinic-default';
                const clinicForMerchant = db.db?.prepare?.('SELECT clinic_id FROM clinics WHERE merchant_id = ? LIMIT 1').get(merchant.id);
                clinic = clinicForMerchant ? { clinic_id: clinicForMerchant.clinic_id } : (defaultClinicId ? { clinic_id: defaultClinicId } : null);
              } catch (_) {
                const fallback = process.env.DEFAULT_CLINIC_ID || process.env.PRIMARY_CLINIC_ID || 'clinic-default';
                clinic = fallback ? { clinic_id: fallback } : null;
              }
            }
          }
        }
      }
    }
    
    // Define navigation items - tenant-aware
    // Medical/clinic: Claims = create + view. Revenue = money collected.
    const clinicNavItems = [
      { id: 'dashboard', label: 'Home', icon: '📊', href: 'business-dashboard.html' },
      { id: 'calendar', label: 'Calendar', icon: '📅', href: 'calendar.html' },
      { id: 'patients', label: 'Patients', icon: '👥', href: 'patients.html' },
      { id: 'claims', label: 'Claims', icon: '📋', href: 'billing.html?section=claims' },
      { id: 'billing', label: 'Revenue', icon: '💳', href: 'billing.html?section=overview' },
      { id: 'video', label: 'Video', icon: '📹', href: 'video-call.html' }
    ];
    
    const shopNavItems = [
      { id: 'dashboard', label: 'Dashboard', icon: '📊', href: 'business-dashboard.html' },
      { id: 'products', label: 'Products', icon: '📦', href: 'products.html' },
      { id: 'orders', label: 'Orders', icon: '🛒', href: 'orders.html' },
      { id: 'customers', label: 'Customers', icon: '👥', href: 'patients.html' },
      { id: 'billing', label: 'Billing', icon: '💳', href: 'billing.html' },
      { id: 'agent', label: 'Voice Agent', icon: '🎙️', href: 'agent.html' }
    ];
    
    const featureFlags = require('../utils/feature-flags');
    const flagsConfig = featureFlags.getConfig ? featureFlags.getConfig() : {};
    let effectivePolicy = null;
    try {
      if (clinic?.clinic_id || merchant?.id) {
        const profile = db.getClinicPromptProfile?.(clinic?.clinic_id || null, merchant?.id || null);
        if (profile) {
          effectivePolicy = getEffectiveTenantPolicy(profile);
        }
      }
    } catch (_) {}

    res.json({
      success: true,
      hostname,
      subdomain,
      tenant_type: tenantType,
      navItems: tenantType === 'shop' ? shopNavItems : clinicNavItems,
      sidebarSubtitle: tenantType === 'shop' 
        ? '24/7 Medical Assistant' 
        : "Doctor's Portal",
      merchant_id: merchant?.id || null,
      clinic_id: clinic?.clinic_id || null,
      feature_flags: flagsConfig,
      effective_policy: effectivePolicy
    });
  } catch (error) {
    console.error('❌ Error getting tenant config:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get tenant configuration',
      message: error.message
    });
  }
});

module.exports = router;

