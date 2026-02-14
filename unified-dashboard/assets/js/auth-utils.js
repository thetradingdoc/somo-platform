/**
 * Shared Auth Utilities
 * Single source of truth for auth checks, session keys, and logout across business pages
 */

(function () {
  const AUTH_KEYS = {
    AUTHENTICATED: 'authenticated',
    USER: 'user'
  };

  /**
   * Require authentication. Redirects to login if not authenticated.
   * @param {string} loginPath - Path to login page (default: '../login.html')
   * @returns {object|null} User data if authenticated, null if redirected
   */
  window.requireAuth = function (loginPath) {
    const path = loginPath || '../login.html';
    if (sessionStorage.getItem(AUTH_KEYS.AUTHENTICATED) !== 'true') {
      window.location.href = path;
      return null;
    }
    return window.getUserData();
  };

  /**
   * Get current user data from session. Supports both 'user' and legacy 'customer' keys.
   * @returns {object} User object with name, role, etc.
   */
  window.getUserData = function () {
    const userStr = sessionStorage.getItem(AUTH_KEYS.USER);
    const customerStr = sessionStorage.getItem('customer');
    if (userStr) {
      try {
        return JSON.parse(userStr);
      } catch (_) {
        return {};
      }
    }
    if (customerStr) {
      try {
        const customer = JSON.parse(customerStr);
        return {
          name: customer.name || customer.company_name || 'User',
          role: customer.role || 'Provider',
          ...customer
        };
      } catch (_) {
        return {};
      }
    }
    return {};
  };

  /**
   * Logout and redirect to login.
   * Clears all auth-related session keys consistently.
   * @param {string} loginPath - Path to login page (default: '../login.html')
   */
  window.logout = function (loginPath) {
    const keysToRemove = [
      AUTH_KEYS.AUTHENTICATED,
      AUTH_KEYS.USER,
      'customer',
      'userName',
      'userRole'
    ];
    keysToRemove.forEach((key) => sessionStorage.removeItem(key));
    const path = loginPath || '../login.html';
    window.location.href = path;
  };

  window.AUTH_KEYS = AUTH_KEYS;
})();
