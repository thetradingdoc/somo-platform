/**
 * Somo provider sign-in — POST /api/customers/login, forgot password, safe redirect.
 */
(function () {
  const API_BASE = (typeof resolveApiBase === 'function' ? resolveApiBase() : (window.API_BASE || window.location.origin).replace(/\/$/, ''));
  const DEFAULT_HOME = '/business/today.html';

  if (window.location.hash === '#signup' || window.location.search.includes('signup=true')) {
    window.location.replace('/signup');
    return;
  }

  function getSafeRedirect() {
    const raw = new URLSearchParams(window.location.search).get('redirect');
    if (!raw || !raw.trim()) return null;
    const trimmed = raw.trim();
    try {
      const u = new URL(trimmed, window.location.origin);
      if (u.origin !== window.location.origin) return null;
      return u.pathname + u.search + u.hash;
    } catch (_) {
      if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
      return null;
    }
  }

  function showToast(message, type) {
    const el = document.getElementById('loginToast');
    if (!el) return;
    el.textContent = message;
    el.className = `signup-toast ${type || 'error'}`;
    el.classList.remove('hidden');
  }

  function hideToast() {
    document.getElementById('loginToast')?.classList.add('hidden');
  }

  function showPanel(panel) {
    document.getElementById('loginPanel')?.classList.toggle('hidden', panel !== 'login');
    document.getElementById('forgotPanel')?.classList.toggle('hidden', panel !== 'forgot');
    hideToast();
  }

  function persistCustomer(customer) {
    sessionStorage.setItem('authenticated', 'true');
    sessionStorage.setItem('customer', JSON.stringify(customer));
    sessionStorage.setItem(
      'user',
      JSON.stringify({
        name: customer.name || customer.company_name || 'User',
        role: customer.role || 'Provider',
        ...customer
      })
    );
    if (typeof persistProviderCustomer === 'function') {
      persistProviderCustomer(customer);
    }
  }

  function resolvePostLoginUrl(customer) {
    const redirect = getSafeRedirect();
    if (redirect) return redirect;

    const host = window.location.hostname.toLowerCase();
    const subdomain = customer?.subdomain;
    if (host === 'localhost' || host === '127.0.0.1') {
      return DEFAULT_HOME;
    }
    if (subdomain && host.includes(`${subdomain}.myskinandcare.com`)) {
      return DEFAULT_HOME;
    }
    if (subdomain) {
      return `https://${subdomain}.myskinandcare.com${DEFAULT_HOME}`;
    }
    return DEFAULT_HOME;
  }

  async function login(email, password) {
    const btn = document.getElementById('loginSubmit');
    const rememberMe = document.getElementById('loginRemember')?.checked;
    hideToast();
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Signing in…';
    }

    try {
      const response = await fetch(`${API_BASE}/api/customers/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, remember_me: !!rememberMe })
      });

      let data = {};
      try {
        data = await response.json();
      } catch (_) {}

      if (!response.ok || !data.success) {
        throw new Error(data.error || data.message || 'Invalid email or password');
      }

      const customer = data.customer || {};
      persistCustomer(customer);
      window.location.href = resolvePostLoginUrl(customer);
    } catch (err) {
      showToast(err.message || 'Sign in failed', 'error');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }
    }
  }

  async function forgotPassword(email) {
    const btn = document.getElementById('forgotSubmit');
    hideToast();
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Sending…';
    }

    try {
      const response = await fetch(`${API_BASE}/api/customers/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || data.message || 'Failed to send reset link');
      }
      showToast('Check your email for a password reset link.', 'success');
      setTimeout(() => showPanel('login'), 3000);
    } catch (err) {
      showToast(err.message || 'Failed to send reset link', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Send reset link';
      }
    }
  }

  function togglePassword() {
    const input = document.getElementById('loginPassword');
    const btn = document.getElementById('loginShowPassword');
    if (!input || !btn) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Hide' : 'Show';
  }

  function bind() {
    document.getElementById('loginForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail')?.value?.trim();
      const password = document.getElementById('loginPassword')?.value;
      if (email && password) login(email, password);
    });

    document.getElementById('forgotForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('forgotEmail')?.value?.trim();
      if (email) forgotPassword(email);
    });

    document.getElementById('loginShowPassword')?.addEventListener('click', togglePassword);
    document.getElementById('loginForgotLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      showPanel('forgot');
    });
    document.getElementById('forgotBackLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      showPanel('login');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
