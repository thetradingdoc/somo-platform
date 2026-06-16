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
      let customer = null;
      const sessionRes = await fetch(`${base}/api/signup/session`, {
        method: 'GET',
        credentials: 'include'
      });
      const sessionData = await sessionRes.json().catch(() => ({}));
      if (
        sessionRes.status === 401 &&
        (sessionData.error === 'orphaned_session' || sessionData.error === 'Invalid session')
      ) {
        document.cookie = 'customer_session=; Max-Age=0; path=/';
        return null;
      }
      if (sessionRes.ok && sessionData.success && sessionData.customer) {
        customer = sessionData.customer;
      }
      const meRes = await fetch(`${base}/api/customers/me`, { credentials: 'include' });
      if (meRes.ok) {
        const meData = await meRes.json().catch(() => ({}));
        if (meData.success && meData.customer) {
          const merged = { ...(customer || {}), ...meData.customer };
          if (!Array.isArray(merged.capabilities) || merged.capabilities.length === 0) {
            console.warn(
              '[session] /api/customers/me returned no capabilities — admin pages will be hidden. ' +
              'Ensure customer-capabilities.js getCapabilities() returns a non-empty array for this account.'
            );
          }
          customer = merged;
        }
      }
      if (customer) {
        persistProviderCustomer(customer);
        return customer;
      }
    } catch (e) {
      console.warn('[provider-session] hydrate failed:', e.message);
    }
    return null;
  }

  global.persistProviderCustomer = persistProviderCustomer;
  global.hydrateProviderSession = hydrateProviderSession;
})(typeof window !== 'undefined' ? window : global);
