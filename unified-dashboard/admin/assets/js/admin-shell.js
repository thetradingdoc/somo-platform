/**
 * Shared admin CRM shell — sidebar, API helpers, toasts, capabilities, env badge
 */
(function () {
  const NAV = [
    { id: 'board', href: '/admin/', label: 'Control board', icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' },
    { id: 'pipeline', href: '/admin/pipeline.html', label: 'Sales pipeline', icon: '<path d="M3 6h18M3 12h14M3 18h9"/>' },
    { id: 'tenants', href: '/admin/tenants.html', label: 'Tenants', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
    { id: 'sales-agent', href: '/admin/sales-agent.html', label: 'Sales agent', icon: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>' },
    { id: 'provider', href: '/business/today.html', label: 'Provider portal', icon: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>', bottom: true },
  ];

  let capabilities = [];
  let sessionLoaded = false;
  const callsInFlight = new Set();

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function adminLoginUrl() {
    const origin = window.location.origin || '';
    const returnTo = encodeURIComponent(window.location.href);
    return `${origin}/login.html?redirect=${returnTo}&admin=1`;
  }

  function ensureToastContainer() {
    let el = document.getElementById('adminToastContainer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'adminToastContainer';
      el.className = 'admin-crm-toast-container';
      document.body.appendChild(el);
    }
    return el;
  }

  function showToast(message, type = 'info', durationMs = 4500) {
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = `admin-crm-toast admin-crm-toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, durationMs);
  }

  function showAuthRequired() {
    let banner = document.getElementById('adminAuthBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'adminAuthBanner';
      banner.className = 'admin-crm-status-banner';
      banner.style.cssText = 'background:#faeeda;border-color:#633806;margin-bottom:12px;';
      const main = document.querySelector('.admin-crm-main');
      if (main) {
        main.insertBefore(banner, main.firstChild?.nextSibling || main.firstChild);
      }
    }
    const loginHref = adminLoginUrl();
    banner.innerHTML = `
      <span style="font-size:13px;color:#633806;">
        Session expired or not signed in.
        <a href="${loginHref}" style="color:#238108;font-weight:600;margin-left:6px;">Sign in again</a>
      </span>`;
    banner.style.display = 'flex';
  }

  function apiBaseLabel() {
    const base = window.API_BASE || '';
    if (!base) return 'local';
    try {
      const u = new URL(base);
      if (u.hostname.includes('localhost') || u.hostname === '127.0.0.1') return 'local';
      if (u.hostname.includes('staging')) return 'staging';
      return 'prod';
    } catch {
      return base.slice(0, 24);
    }
  }

  function renderEnvBadge() {
    const override = localStorage.getItem('api_base');
    const label = apiBaseLabel();
    let el = document.getElementById('adminEnvBadge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'adminEnvBadge';
      el.className = 'admin-crm-env-badge';
      document.body.appendChild(el);
    }
    const warn = override ? ' · override' : '';
    el.textContent = `API: ${label}${warn}`;
    el.title = override
      ? `Using localStorage.api_base override: ${override}`
      : (window.API_BASE || 'same-origin');
    if (override) el.classList.add('warn');
  }

  async function apiFetch(path, opts = {}) {
    const API = window.API_BASE || '';
    const resp = await fetch(`${API}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });

    if (resp.status === 401) {
      const onAdmin = window.location.pathname.startsWith('/admin');
      const origin = window.location.origin || '';
      const loginUrl = onAdmin
        ? `${origin}/login.html`
        : (API ? `${API}/login.html` : '/login.html');
      const willRedirect = onAdmin && !sessionStorage.getItem('admin_auth_redirect');
      if (willRedirect) {
        sessionStorage.setItem('admin_auth_redirect', '1');
        const returnTo = encodeURIComponent(window.location.href);
        window.location.href = `${loginUrl}?redirect=${returnTo}&admin=1`;
      } else if (onAdmin) {
        showAuthRequired();
      }
      throw new Error('Authentication required — log in as operator');
    }
    if (!resp.ok) {
      let msg = `${resp.status} ${resp.statusText}`;
      try {
        const j = await resp.json();
        msg = j.error || j.message || msg;
      } catch { /* ignore */ }
      throw new Error(msg);
    }
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) return resp.json();
    return resp;
  }

  async function loadSession() {
    try {
      const r = await apiFetch('/api/admin/session');
      capabilities = Array.isArray(r.capabilities) ? r.capabilities : [];
      sessionLoaded = true;
      applyCapabilityGating();
      return r;
    } catch {
      capabilities = [];
      sessionLoaded = true;
      return null;
    }
  }

  function hasCapability(cap) {
    if (!cap) return true;
    return capabilities.includes(cap);
  }

  function applyCapabilityGating() {
    document.querySelectorAll('[data-require-capability]').forEach((el) => {
      const cap = el.getAttribute('data-require-capability');
      if (!hasCapability(cap)) {
        el.style.display = 'none';
        el.setAttribute('aria-hidden', 'true');
      }
    });
  }

  function renderSidebar(activeId) {
    const el = document.getElementById('admin-sidebar');
    if (!el) return;

    const top = NAV.filter((n) => !n.bottom);
    const bottom = NAV.filter((n) => n.bottom);

    const link = (item) => {
      const active = item.id === activeId ? ' active' : '';
      return `<a href="${item.href}" class="admin-crm-nav${active}" title="${esc(item.label)}">
        <span class="tooltip">${esc(item.label)}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${item.icon}</svg>
      </a>`;
    };

    el.className = 'admin-crm-sidebar';
    el.innerHTML = `
      <div class="admin-crm-logo">S</div>
      ${top.map(link).join('')}
      <div class="admin-crm-sidebar-spacer"></div>
      ${bottom.map(link).join('')}
    `;
  }

  async function consumeSse(resp, addLine, onEvt) {
    if (!resp.ok) {
      let msg = `${resp.status}`;
      try {
        const j = await resp.json();
        msg = j.error || j.message || msg;
      } catch { /* ignore */ }
      throw new Error(msg);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          if (evt.type === 'start') addLine('Job started');
          else if (evt.type === 'done') addLine(`Done — ${evt.result?.saved ?? evt.enriched ?? evt.result?.saved_callable ?? 'complete'}`);
          else if (evt.type === 'error') addLine('Error: ' + evt.error);
          else if (evt.msg) addLine(evt.msg);
          else if (evt.type === 'progress') addLine(`Lead ${evt.id}: ${evt.status || evt.msg || ''}`);
          onEvt?.(evt);
        } catch { /* skip */ }
      }
    }
  }

  function confirmAction(message) {
    return window.confirm(message);
  }

  async function callLead(id, name, opts = {}) {
    if (callsInFlight.has(String(id))) {
      showToast('Call already in progress for this lead', 'warning');
      return null;
    }
    const msg = opts.skipConfirm
      ? null
      : `Place outbound sales call to ${name}?`;
    if (msg && !confirmAction(msg)) return null;

    callsInFlight.add(String(id));
    const btn = opts.buttonEl;
    if (btn) {
      btn.disabled = true;
      btn.dataset.prevText = btn.textContent;
      btn.textContent = 'Calling…';
    }
    try {
      const r = await apiFetch(`/api/admin/leads/${id}/call`, { method: 'POST' });
      showToast(r.message || 'Call initiated', 'success');
      opts.onSuccess?.(r);
      return r;
    } catch (e) {
      showToast('Call failed: ' + e.message, 'error');
      throw e;
    } finally {
      callsInFlight.delete(String(id));
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.prevText || 'Call';
      }
    }
  }

  function loadAiAssistant() {
    if (window.adminAIAssistant) return;
    if (document.querySelector('link[href*="admin-ai-assistant.css"]')) return;
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/admin/assets/css/admin-ai-assistant.css';
    document.head.appendChild(css);
    const script = document.createElement('script');
    script.src = '/admin/assets/js/admin-ai-assistant.js';
    document.body.appendChild(script);
  }

  async function loadSuggestions() {
    if (!hasCapability('platform.leads')) return;
    try {
      const r = await apiFetch('/api/admin/ai/suggestions');
      const suggestions = r.suggestions || [];
      if (!suggestions.length) return;

      let strip = document.getElementById('adminSuggestionsStrip');
      if (!strip) {
        strip = document.createElement('div');
        strip.id = 'adminSuggestionsStrip';
        strip.className = 'admin-crm-suggestion-banner';
        strip.style.marginBottom = '12px';
        const main = document.querySelector('.admin-crm-main');
        if (main) main.insertBefore(strip, main.firstChild);
      }

      strip.innerHTML = suggestions.map((s) => {
        if (s.type === 'enrich') {
          return `<div><strong>Suggestion:</strong> ${esc(s.message)} — <a href="/admin/pipeline.html#needs-phone" style="color:var(--accent-green);">Open queue</a></div>`;
        }
        if (s.type === 'call' && s.leads?.length) {
          const names = s.leads.map((l) => esc(l.clinic_name)).join(', ');
          return `<div><strong>Suggestion:</strong> ${esc(s.message)} (${names}) — <a href="/admin/pipeline.html" style="color:var(--accent-green);">Call queue</a></div>`;
        }
        return `<div>${esc(s.message || '')}</div>`;
      }).join('');
    } catch {
      /* optional */
    }
  }

  function initAdminShell(activeId, opts = {}) {
    document.body.classList.add('shell', 'admin-portal-body');
    renderSidebar(activeId);
    renderEnvBadge();
    if (localStorage.getItem('api_base')) {
      showToast('Using localStorage api_base override — data may not match production', 'warning', 6000);
    }
    loadSession().then(() => {
      if (hasCapability('platform.leads')) {
        loadSuggestions();
      }
      if (opts.enableAi !== false && hasCapability('platform.leads')) {
        loadAiAssistant();
      }
    });
  }

  window.AdminShell = {
    init: initAdminShell,
    apiFetch,
    esc,
    NAV,
    showAuthRequired,
    adminLoginUrl,
    showToast,
    consumeSse,
    callLead,
    confirmAction,
    hasCapability,
    loadSession,
    get capabilities() { return capabilities.slice(); },
    isCallInFlight: (id) => callsInFlight.has(String(id)),
  };
})();
