/**
 * API Configuration
 * Auto-detects API URL based on environment
 * 
 * Priority:
 * 1. URL parameter: ?api=https://your-api-url.com
 * 2. localStorage: 'api_base' key
 * 3. Environment variable (for Netlify/builds)
 * 4. Auto-detect from domain
 * 5. Default: http://localhost:4000
 */

(function () {
  const hostname = window.location.hostname;

  // Check for URL parameter override
  const urlParams = new URLSearchParams(window.location.search);
  const apiParam = urlParams.get('api');
  if (apiParam) {
    window.API_BASE = apiParam;
    localStorage.setItem('api_base', apiParam);
    console.log('🌐 API Base URL (from URL param):', window.API_BASE);
    return;
  }

  // Check localStorage override
  const storedApi = localStorage.getItem('api_base');
  if (storedApi) {
    window.API_BASE = storedApi;
    console.log('🌐 API Base URL (from localStorage):', window.API_BASE);
    return;
  }

  // Check for production domain (doclittle.site)
  if (hostname === 'doclittle.site' || hostname === 'www.doclittle.site' || hostname.includes('doclittle.site')) {
    // For production, use api.doclittle.site subdomain
    window.API_BASE = 'https://api.doclittle.site';
    console.log('🌐 API Base URL (production - doclittle.site):', window.API_BASE);
    return;
  }

  // Auto-detect for external domains
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    // If accessing via ngrok (legacy - should not be used in production)
    if (hostname.includes('ngrok') || hostname.includes('ngrok-free') || hostname.includes('ngrok.io')) {
      console.warn('⚠️  Detected ngrok access. Please use production domain instead.');
      window.API_BASE = 'https://api.doclittle.site';
    } else if (hostname.includes('netlify.app')) {
      // Netlify - use api.doclittle.site
      window.API_BASE = 'https://api.doclittle.site';
    } else if (hostname === 'doclittle.site' || hostname === 'www.doclittle.site') {
      // Production domain - use api.doclittle.site subdomain
      window.API_BASE = 'https://api.doclittle.site';
    } else if (hostname.includes('azurewebsites.net')) {
      // Azure App Service - use api subdomain
      window.API_BASE = 'https://api.doclittle.site';
    } else {
      // Other custom domain - use api.doclittle.site (or configure as needed)
      window.API_BASE = 'https://api.doclittle.site';
    }
  } else {
    // Local access
    window.API_BASE = 'http://localhost:4000';
  }

  console.log('🌐 API Base URL:', window.API_BASE);

  /**
   * Per-tenant configuration
   * - Fetches tenant_type and navigation tabs from API (database-driven)
   * - Falls back to default if API call fails
   */

  // Extract subdomain if present (e.g. akin-dunbar.doclittle.site)
  let subdomain = null;
  const parts = hostname.split('.');
  if (parts.length > 2) {
    subdomain = parts[0];
  } else if (parts.length === 2 && hostname !== 'localhost') {
    // e.g. akin-dunbar.local or similar
    subdomain = parts[0];
  }

  // Tenant-aware navigation (single source of truth)
  // Medical/clinic: Claims = create + view. Revenue = money collected.
  const MEDICAL_NAV_ITEMS = [
    { id: 'dashboard', label: 'Home', icon: '📊', href: 'business-dashboard.html' },
    { id: 'calendar', label: 'Calendar', icon: '📅', href: 'calendar.html' },
    { id: 'patients', label: 'Patients', icon: '👥', href: 'patients.html' },
    { id: 'claims', label: 'Claims', icon: '📋', href: 'billing.html?section=claims' },
    { id: 'billing', label: 'Revenue', icon: '💳', href: 'billing.html?section=overview' },
    { id: 'video', label: 'Video', icon: '📹', href: 'video-call.html' }
  ];

  const ECOMMERCE_NAV_ITEMS = [
    { id: 'dashboard', label: 'Dashboard', icon: '📊', href: 'business-dashboard.html' },
    { id: 'products', label: 'Products', icon: '📦', href: 'products.html' },
    { id: 'orders', label: 'Orders', icon: '🛒', href: 'orders.html' },
    { id: 'patients', label: 'Customers', icon: '👥', href: 'patients.html' },
    { id: 'billing', label: 'Billing', icon: '💳', href: 'billing.html' },
    { id: 'agent', label: 'Voice Agent', icon: '🎙️', href: 'agent.html' }
  ];

  const NAV_BY_TENANT = {
    clinic: MEDICAL_NAV_ITEMS,
    shop: ECOMMERCE_NAV_ITEMS
  };

  // Default config (fallback) - clinic for medical coding
  const defaultConfig = {
    hostname,
    subdomain,
    tenant_type: 'clinic',
    navItems: NAV_BY_TENANT.clinic,
    sidebarSubtitle: 'Medical Coding Assistant'
  };

  window.MEDICAL_NAV_ITEMS = MEDICAL_NAV_ITEMS;
  window.ECOMMERCE_NAV_ITEMS = ECOMMERCE_NAV_ITEMS;
  window.NAV_BY_TENANT = NAV_BY_TENANT;

  // Try to fetch tenant config from API
  // Use async IIFE to fetch config without blocking page load
  (async function() {
    try {
      const response = await fetch(`${window.API_BASE}/api/tenant/config`, {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          const tenantType = data.tenant_type || 'clinic';
          window.TENANT_CONFIG = {
            hostname: data.hostname,
            subdomain: data.subdomain,
            tenant_type: tenantType,
            navItems: data.navItems || (window.NAV_BY_TENANT && window.NAV_BY_TENANT[tenantType]) || MEDICAL_NAV_ITEMS,
            sidebarSubtitle: data.sidebarSubtitle || 'Medical Coding Assistant',
            merchant_id: data.merchant_id,
            clinic_id: data.clinic_id
          };
          console.log('🧩 Tenant config (from API):', window.TENANT_CONFIG);
          return;
        }
      }
    } catch (error) {
      console.warn('⚠️  Could not fetch tenant config from API, using defaults:', error.message);
    }
    
    // Fallback to default config
    window.TENANT_CONFIG = defaultConfig;
    console.log('🧩 Tenant config (fallback):', window.TENANT_CONFIG);
  })();
  
  // Set initial config to default (will be updated async if API call succeeds)
  window.TENANT_CONFIG = defaultConfig;

  /**
   * Path Utility Functions
   * Provides sustainable path resolution for all business pages
   * Fixes mobile/desktop path resolution issues using native URL API
   * 
   * This solution is sustainable because:
   * 1. Uses browser-native URL API (works everywhere)
   * 2. Handles all edge cases automatically (mobile, desktop, subdomains, redirects)
   * 3. Single source of truth in config.js
   * 4. No hardcoded paths - adapts to any deployment structure
   */
  
  /**
   * Resolve a business page path using native URL API
   * This is the most robust method - handles all browser differences automatically
   * 
   * @param {string} relativePath - Relative path (e.g., 'settings.html', 'products.html')
   * @returns {string} Absolute path (e.g., '/business/settings.html')
   * 
   * @example
   * window.resolveBusinessPath('settings.html') // Returns '/business/settings.html'
   * window.resolveBusinessPath('products.html') // Returns '/business/products.html'
   */
  window.resolveBusinessPath = function(relativePath) {
    try {
      // Use native URL constructor to resolve relative path correctly
      // This handles all edge cases: mobile, desktop, subdomains, redirects, etc.
      const resolvedUrl = new URL(relativePath, window.location.href);
      return resolvedUrl.pathname + (resolvedUrl.search || '');
    } catch (error) {
      // Fallback: if URL constructor fails, use manual resolution
      console.warn('Path resolution fallback used:', error);
      const pathname = window.location.pathname;
      
      // If we're in /business/, resolve relative to current directory
      if (pathname.includes('/business/')) {
        const basePath = pathname.substring(0, pathname.lastIndexOf('/'));
        return basePath + '/' + relativePath.replace(/^\//, '');
      }
      
      // Default: assume /business
      return '/business/' + relativePath.replace(/^\//, '');
    }
  };

  /**
   * Navigate to a business page
   * Wrapper function for consistent navigation across all pages
   * 
   * @param {string} relativePath - Relative path to navigate to
   * 
   * @example
   * window.navigateToBusinessPage('settings.html')
   * // Works from any page: /business/products.html, /business/orders.html, etc.
   */
  window.navigateToBusinessPage = function(relativePath) {
    const absolutePath = window.resolveBusinessPath(relativePath);
    window.location.href = absolutePath;
  };

  console.log('✅ Path utilities loaded (sustainable URL-based resolution)');
})();