/**
 * Somo sign-in — provider (/api/customers/login) and operator admin (/api/admin/session).
 */
(function () {
  const API_BASE = (typeof resolveApiBase === 'function' ? resolveApiBase() : (window.API_BASE || window.location.origin).replace(/\/$/, ''));
  const DEFAULT_HOME = '/business/today.html';
  const ADMIN_HOME = '/admin/';
  const params = new URLSearchParams(window.location.search);
  const isAdminLogin = params.get('admin') === '1';

  if (window.location.hash === '#signup' || window.location.search.includes('signup=true')) {
    window.location.replace('/signup');
    return;
  }

  function isAllowedRedirectUrl(url) {
    const host = url.hostname.toLowerCase();
    if (url.origin === window.location.origin) return true;
    if (isAdminLogin && url.pathname.startsWith('/admin')) {
      if (host === 'callsomo.com' || host === 'www.callsomo.com') return true;
      if (host === 'localhost' || host === '127.0.0.1') return true;
    }
    return false;
  }

  function getSafeRedirect() {
    const raw = params.get('redirect');
    if (!raw || !raw.trim()) return null;
    const trimmed = raw.trim();
    try {
      const u = new URL(trimmed, window.location.origin);
      if (!isAllowedRedirectUrl(u)) return null;
      if (u.origin !== window.location.origin) return u.href;
      return u.pathname + u.search + u.hash;
    } catch (_) {
      if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed;
      return null;
    }
  }

  function showToast(message, type) {
    const onForgot = !document.getElementById('forgotPanel')?.classList.contains('hidden');
    const el = document.getElementById(onForgot ? 'forgotToast' : 'loginToast');
    if (!el) return;
    el.textContent = message;
    el.className = `signup-toast ${type || 'error'}`;
    el.classList.remove('hidden');
  }

  function hideToast() {
    document.getElementById('loginToast')?.classList.add('hidden');
    document.getElementById('forgotToast')?.classList.add('hidden');
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

  async function resolvePostLoginUrl(customer) {
    const explicit = getSafeRedirect();
    if (explicit) return explicit;

    if (window.SomoOnboardingRedirect?.resolveProviderPostLoginUrl) {
      const dest = await window.SomoOnboardingRedirect.resolveProviderPostLoginUrl(customer, {
        explicitRedirect: null
      });
      if (dest) {
        const host = window.location.hostname.toLowerCase();
        const subdomain = customer?.subdomain;
        if (subdomain && host !== 'localhost' && host !== '127.0.0.1' && !host.includes(`${subdomain}.callsomo.com`)) {
          return `https://${subdomain}.callsomo.com${dest}`;
        }
        return dest;
      }
    }

    const host = window.location.hostname.toLowerCase();
    const subdomain = customer?.subdomain;
    if (host === 'localhost' || host === '127.0.0.1') {
      return DEFAULT_HOME;
    }
    if (subdomain && host.includes(`${subdomain}.callsomo.com`)) {
      return DEFAULT_HOME;
    }
    if (subdomain) {
      return `https://${subdomain}.callsomo.com${DEFAULT_HOME}`;
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
      try {
        const meRes = await fetch(`${API_BASE}/api/customers/me`, { credentials: 'include' });
        if (meRes.ok) {
          const meData = await meRes.json();
          if (meData.success && meData.customer) {
            Object.assign(customer, meData.customer);
          }
        }
      } catch (_) { /* non-fatal */ }
      persistCustomer(customer);
      const destination = await resolvePostLoginUrl(customer);
      window.location.href = destination;
    } catch (err) {
      showToast(err.message || 'Sign in failed', 'error');
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }
    }
  }

  let adminCodeStep = false;

  function ensureAdminCodeField() {
    let field = document.getElementById('adminCodeField');
    if (field) return field;
    const form = document.getElementById('loginForm');
    const submitBtn = document.getElementById('loginSubmit');
    if (!form || !submitBtn) return null;
    field = document.createElement('label');
    field.className = 'signup-field hidden';
    field.id = 'adminCodeField';
    field.innerHTML = `
      <span>Verification code</span>
      <input type="text" id="adminCode" placeholder="6-digit code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" />
    `;
    form.insertBefore(field, submitBtn);
    return field;
  }

  function configureAdminLoginUi() {
    sessionStorage.removeItem('admin_auth_redirect');
    document.title = 'Somo — Operator sign in';
    const eyebrow = document.querySelector('#loginPanel .signup-eyebrow');
    const title = document.querySelector('#loginPanel .signup-title');
    const sub = document.querySelector('#loginPanel .signup-sub');
    if (eyebrow) eyebrow.textContent = 'Operator access';
    if (title) title.textContent = 'Sign in to admin portal';
    if (sub) sub.textContent = 'Use your operator account. A verification code will be emailed for security.';
    document.getElementById('loginRemember')?.closest('.login-options')?.classList.add('hidden');
    document.querySelector('.login-footer-link')?.classList.add('hidden');
    const btn = document.getElementById('loginSubmit');
    if (btn) btn.textContent = 'Continue';
    ensureAdminCodeField();
  }

  async function adminLogin(email, password, code) {
    const btn = document.getElementById('loginSubmit');
    hideToast();
    if (btn) {
      btn.disabled = true;
      btn.textContent = adminCodeStep ? 'Verifying…' : 'Sending code…';
    }

    const body = { email, password };
    if (adminCodeStep) body.code = code;

    try {
      const response = await fetch(`${API_BASE}/api/admin/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      let data = {};
      try { data = await response.json(); } catch (_) {}

      if (!response.ok || data.success === false) {
        throw new Error(data.error || data.message || 'Admin sign in failed');
      }

      if (data.step === 'verify_code' && !adminCodeStep) {
        adminCodeStep = true;
        const codeField = ensureAdminCodeField();
        codeField?.classList.remove('hidden');
        document.getElementById('adminCode')?.focus();
        showToast(data.message || 'Verification code sent to your email', 'success');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Verify & continue';
        }
        return;
      }

      sessionStorage.removeItem('admin_auth_redirect');
      const redirect = getSafeRedirect();
      window.location.href = redirect || ADMIN_HOME;
    } catch (err) {
      showToast(err.message || 'Admin sign in failed', 'error');
      if (btn) {
        btn.disabled = false;
        btn.textContent = adminCodeStep ? 'Verify & continue' : 'Continue';
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
    if (isAdminLogin) configureAdminLoginUi();

    document.getElementById('loginForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail')?.value?.trim();
      const password = document.getElementById('loginPassword')?.value;
      if (!email || !password) return;
      if (isAdminLogin) {
        const code = document.getElementById('adminCode')?.value?.trim();
        adminLogin(email, password, code);
      } else {
        login(email, password);
      }
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
