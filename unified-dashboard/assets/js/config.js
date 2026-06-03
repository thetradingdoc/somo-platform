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

  const PROD_API = 'https://api.callsomo.com';
  const host = hostname.toLowerCase();
  const isCallsomoHost =
    host === 'callsomo.com' ||
    host === 'www.callsomo.com' ||
    host.endsWith('.callsomo.com');

  if (isCallsomoHost) {
    window.API_BASE = PROD_API;
    console.log('🌐 API Base URL (production):', window.API_BASE);
    return;
  }

  // Auto-detect for external domains
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    // If accessing via ngrok, use current origin so API calls hit your tunnel
    if (hostname.includes('ngrok') || hostname.includes('ngrok-free') || hostname.includes('ngrok.io')) {
      // Use current origin when accessed via ngrok so API calls hit your tunnel
      window.API_BASE = window.location.origin;
      console.log('🌐 API Base URL (ngrok):', window.API_BASE);
    } else if (hostname.includes('netlify.app')) {
      window.API_BASE = PROD_API;
    } else if (hostname.includes('azurewebsites.net')) {
      window.API_BASE = PROD_API;
    } else {
      window.API_BASE = PROD_API;
    }
  } else {
    // Match page origin so 127.0.0.1:4000 and localhost:4000 are not cross-origin.
    window.API_BASE = (window.location.origin || 'http://localhost:4000').replace(/\/$/, '');
  }

  console.log('🌐 API Base URL:', window.API_BASE);

  /**
   * Per-tenant configuration
   * - Fetches tenant_type and navigation tabs from API (database-driven)
   * - Falls back to default if API call fails
   */

  // Extract subdomain if present (e.g. tenant.callsomo.com)
  let subdomain = null;
  const parts = hostname.split('.');
  if (parts.length > 2) {
    subdomain = parts[0];
  } else if (parts.length === 2 && hostname !== 'localhost') {
    // e.g. akin-dunbar.local or similar
    subdomain = parts[0];
  }

  // Legacy tenant nav for non-shell pages. Provider portal SSOT: PORTAL_NAV_BASE in provider-shell.js.
  // Medical/clinic: Claims = create + view. Revenue = money collected.
  // Icons use Tailwind/Heroicons SVG keys for consistency.
  const MEDICAL_NAV_ITEMS = [
    { id: 'today', label: 'Today', icon: 'home', href: 'today.html' },
    { id: 'calendar', label: 'Schedule', icon: 'calendar-days', href: 'calendar.html' },
    { id: 'patients', label: 'Patients', icon: 'user-group', href: 'patients.html' },
    { id: 'claims', label: 'Claims & RCM', icon: 'clipboard-document-list', href: 'billing.html?section=overview' },
    { id: 'prior-auth', label: 'Prior Auth', icon: 'document-text', href: 'billing.html?section=prior-auth' },
    { id: 'billing', label: 'Invoices', icon: 'banknotes', href: 'billing.html?section=invoices' },
    { id: 'agent', label: 'Voice Agent', icon: 'microphone', href: 'agent.html' },
    { id: 'exceptions', label: 'Exceptions', icon: 'clipboard-document-list', href: 'claims.html' },
    { id: 'profile', label: 'Settings', icon: 'user', href: 'settings.html' }
  ];

  const NAV_BY_TENANT = {
    clinic: MEDICAL_NAV_ITEMS,
    shop: MEDICAL_NAV_ITEMS
  };

  const NAV_ICONS = {
    home: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"/></svg>',
    'chart-bar': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"/></svg>',
    'calendar-days': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 2.25v.75H4.5a.75.75 0 0 0-.75.75v15c0 .414.336.75.75.75h15a.75.75 0 0 0 .75-.75V3a.75.75 0 0 0-.75-.75h-2.25V2.25Zm0 13.5h10.5V6.75H6.75v8.75Z"/></svg>',
    'user-group': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z"/></svg>',
    user: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z"/></svg>',
    wallet: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 12m18 0v6a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 18v-6m18-0V9M3 12V9m18 0a2.25 2.25 0 0 0-2.25-2.25H15a3 3 0 1 1-6 0H5.25A2.25 2.25 0 0 0 3 9m18 3v6"/></svg>',
    'clipboard-document-list': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08A2.251 2.251 0 0 0 8.25 4.95 2.25 2.25 0 0 0 6 7.124v11.25a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25V9.75a2.25 2.25 0 0 0-2.25-2.25h-3.379a2.25 2.25 0 0 1-1.897-1.036l-.43-.66a2.25 2.25 0 0 0-1.897-1.036H9.75a2.25 2.25 0 0 0-2.25 2.25Z"/></svg>',
    banknotes: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0 .75-.75v-.75m0 2.25h.375c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-.375m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125v-.75m13.5 3c0 .621-.504 1.125-1.125 1.125H1.125C.504 20.25 0 19.746 0 19.125V6.621c0-1.355.685-2.031 1.414-2.219l2.078-.659A3 3 0 0 0 5.25 6.621v1.379H3m13.5 3H21M3.75 20.25v1.5c0 .621.504 1.125 1.125 1.125h13.5c.621 0 1.125-.504 1.125-1.125v-1.5m-18 0h18"/></svg>',
    'video-camera': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"/></svg>',
    cube: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m21 7.5-9-5.25L3 7.5m18 0-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9"/></svg>',
    'shopping-cart': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"/></svg>',
    'credit-card': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z"/></svg>',
    microphone: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"/></svg>',
    'document-text': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"/></svg>',
    'magnifying-glass': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/></svg>',
    'exclamation-triangle': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"/></svg>',
    'check-circle': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>',
    phone: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.72 1.072a12.042 12.042 0 0 1-5.49-5.49l1.072-.72c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"/></svg>',
    envelope: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75"/></svg>',
    plus: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>',
    clock: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>',
    'user-check': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"/></svg>',
    clipboard: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08A2.251 2.251 0 0 0 8.25 4.95 2.25 2.25 0 0 0 6 7.124v11.25a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25V9.75a2.25 2.25 0 0 0-2.25-2.25h-3.379a2.25 2.25 0 0 1-1.897-1.036l-.43-.66a2.25 2.25 0 0 0-1.897-1.036H9.75a2.25 2.25 0 0 0-2.25 2.25Z"/></svg>',
    'inbox-stack': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 13.5V3.375A1.125 1.125 0 0 1 10.125 2.25h3.75A1.125 1.125 0 0 1 15 3.375V13.5m-6 0h6m-6 0H4.875A1.125 1.125 0 0 0 3.75 15v6.375A1.125 1.125 0 0 0 4.875 22.5h14.25A1.125 1.125 0 0 0 20.25 21.375V15a1.125 1.125 0 0 0-1.125-1.125H15m-6 0V9.375A1.125 1.125 0 0 1 10.125 8.25h3.75A1.125 1.125 0 0 1 15 9.375V13.5"/></svg>',
    'arrow-path': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>',
    'chevron-left': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5"/></svg>',
    'paper-airplane': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5"/></svg>',
    'building-office-2': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 21h19.5M4.5 3.75A2.25 2.25 0 0 1 6.75 1.5h10.5a2.25 2.25 0 0 1 2.25 2.25V21M6 18h.75v-3.75H6V18Zm3 0h.75v-3.75H9V18Zm3 0h.75v-3.75h-.75V18Zm3 0h.75v-3.75H15V18Zm3 0h.75v-3.75H18V18Z"/></svg>',
    link: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"/></svg>',
    bell: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"/></svg>',
    'lock-closed': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 0 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"/></svg>',
    heart: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z"/></svg>',
    'cog-6-tooth': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>',
    'device-phone-mobile': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"/></svg>',
    'code-bracket': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"/></svg>'
  };
  window.getNavIcon = function (key) { return key ? (NAV_ICONS[key] || key) : ''; };

  // Default config (fallback)
  const defaultConfig = {
    hostname,
    subdomain,
    tenant_type: 'clinic',
    navItems: NAV_BY_TENANT.clinic,
    sidebarSubtitle: 'Somo AI'
  };

  window.MEDICAL_NAV_ITEMS = MEDICAL_NAV_ITEMS;
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
            sidebarSubtitle: data.sidebarSubtitle || 'Healthcare at your home',
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

// Lightweight global patient alert helper for error/info banners
(function () {
  function ensureContainer() {
    let el = document.getElementById('patient-global-alert');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'patient-global-alert';
    el.style.position = 'fixed';
    el.style.zIndex = '9999';
    el.style.left = '50%';
    el.style.top = '16px';
    el.style.transform = 'translateX(-50%)';
    el.style.maxWidth = '480px';
    el.style.width = 'calc(100% - 32px)';
    el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)';
    el.style.borderRadius = '8px';
    el.style.padding = '12px 16px';
    el.style.fontSize = '14px';
    el.style.display = 'none';
    el.style.background = '#fee2e2';
    el.style.color = '#b91c1c';
    el.style.border = '1px solid #fecaca';
    el.style.boxSizing = 'border-box';
    el.setAttribute('role', 'alert');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
    return el;
  }

  window.showPatientAlert = function ({ type = 'error', message, retry } = {}) {
    if (!message) return;
    const el = ensureContainer();
    const isError = type === 'error';
    el.style.background = isError ? '#fee2e2' : '#dbebff';
    el.style.color = isError ? '#b91c1c' : '#1d4ed8';
    el.style.border = isError ? '1px solid #fecaca' : '1px solid #bfdbfe';

    const btnHtml = retry
      ? `<button style="margin-left:12px;padding:4px 10px;font-size:12px;border-radius:999px;border:none;cursor:pointer;background:#111827;color:#f9fafb;">Try again</button>`
      : '';

    el.innerHTML = `<span>${message}</span>${btnHtml}`;
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'space-between';

    if (retry) {
      const btn = el.querySelector('button');
      if (btn) {
        btn.onclick = function () {
          el.style.display = 'none';
          try {
            retry();
          } catch (e) {
            console.warn('Retry handler threw:', e);
          }
        };
      }
    }

    setTimeout(() => {
      el.style.display = 'none';
    }, 8000);
  };
})();

// Register service worker for PWA (installability + basic offline shell)
(function () {
  if ('serviceWorker' in navigator) {
    const swUrl = '/unified-dashboard/sw.js?v=12';
    navigator.serviceWorker
      .register(swUrl)
      .then(() => {
        console.log('✅ Service worker registered:', swUrl);
      })
      .catch((err) => {
        console.warn('⚠️  Service worker registration failed:', err.message);
      });
  }
})();

/**
 * Landing / shop base URL for “Back to shop” and resolving relative product images (/images/...) on checkout.
 * Production: set window.LANDING_BASE before config.js if the shop lives on another origin.
 */
(function () {
  if (typeof window.LANDING_BASE === 'string' && window.LANDING_BASE.length) {
    return;
  }
  /** Root-relative Somo marketing landing */
  var SHOP_INDEX = '/';
  try {
    var base = new URL(window.location.href);
    var path = base.pathname || '';
    if (path.indexOf('/unified-dashboard/') !== -1 || path.indexOf('/patients/') !== -1) {
      window.LANDING_BASE = base.origin + SHOP_INDEX;
    } else {
      window.LANDING_BASE = base.origin + '/';
    }
  } catch (_) {
    window.LANDING_BASE = SHOP_INDEX;
  }
})();