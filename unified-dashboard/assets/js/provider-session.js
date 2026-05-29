/**
 * Persist provider customer context for provider-shell.js (sessionStorage).
 * Cookie session remains source of truth for API auth.
 */
(function (global) {
  function persistProviderCustomer(customer) {
    if (!customer || typeof customer !== 'object') return;
    try {
      global.sessionStorage.setItem('authenticated', 'true');
      global.sessionStorage.setItem('customer', JSON.stringify(customer));
      global.sessionStorage.setItem(
        'user',
        JSON.stringify({
          name: customer.name || customer.company_name || 'User',
          role: customer.role || 'Provider',
          ...customer
        })
      );
    } catch (e) {
      console.warn('[provider-session] persist failed:', e.message);
    }
  }

  async function hydrateProviderSession(apiBase) {
    const base = (apiBase || global.location?.origin || '').replace(/\/$/, '');
    if (!base) return null;
    try {
      const res = await fetch(`${base}/api/signup/session`, {
        method: 'GET',
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && data.customer) {
        persistProviderCustomer(data.customer);
        return data.customer;
      }
    } catch (e) {
      console.warn('[provider-session] hydrate failed:', e.message);
    }
    return null;
  }

  global.persistProviderCustomer = persistProviderCustomer;
  global.hydrateProviderSession = hydrateProviderSession;
})(typeof window !== 'undefined' ? window : global);
