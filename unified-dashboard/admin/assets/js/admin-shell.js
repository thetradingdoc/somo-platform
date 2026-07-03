/**
 * Shared admin CRM shell — sidebar, API helpers, toasts, capabilities, env badge
 */
(function () {
  const NAV = [
    { id: 'board', href: '/admin/', label: 'Control board', group: 'workspace', icon: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>' },
    { id: 'tenants', href: '/admin/tenants.html', label: 'Tenants', group: 'workspace', badgeKey: 'tenants', icon: '<circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.3 3.1-6 7-6s7 2.7 7 6"/><circle cx="17" cy="8" r="2.6"/><path d="M16 14.2c2.8.6 5 2.7 5 5.8"/>' },
    { id: 'pipeline', href: '/admin/pipeline.html', label: 'Pipeline', group: 'workspace', badgeKey: 'pipeline', icon: '<path d="M4 6h16M4 12h16M4 18h10"/>' },
    { id: 'leads', href: '/admin/leads.html', label: 'Leads', group: 'workspace', icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>' },
    { id: 'feature-flags', href: '/admin/feature-flags.html', label: 'Feature flags', group: 'workspace', capability: 'platform.feature_flags', icon: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>' },
    { id: 'sales-agent', href: '/admin/sales-agent.html', label: 'Sales agent', group: 'workspace', icon: '<rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M9 22h6"/>' },
    { id: 'coding-reviews', href: '/admin/coding-reviews.html', label: 'Coding reviews', group: 'workspace', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>' },
    { id: 'provider', href: '/business/today.html', label: 'Provider portal ↗', group: 'shortcuts', external: true, icon: '<path d="M14 3h7v7M21 3l-9 9M5 5h6v0H5v14h14v-6"/>' },
  ];

  let navBadges = {};

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
      banner.className = 'admin-crm-status-banner admin-crm-status-banner--warning';
      banner.style.marginBottom = '12px';
      const main = document.querySelector('.admin-crm-main');
      if (main) {
        main.insertBefore(banner, main.firstChild?.nextSibling || main.firstChild);
      }
    }
    const loginHref = adminLoginUrl();
    banner.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.3 3.9L2.6 17.5A1.9 1.9 0 0 0 4.3 20.5h15.4a1.9 1.9 0 0 0 1.7-3L13.7 3.9a1.9 1.9 0 0 0-3.4 0z"/></svg>
      <span style="font-size:13px;flex:1;">
        Session expired or not signed in.
        <a href="${loginHref}" class="admin-crm-banner-link">Sign in again</a>
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

  function apiHostLabel() {
    const base = window.API_BASE || '';
    if (!base) return 'local';
    try {
      const u = new URL(base);
      return u.hostname.replace(/^www\./, '');
    } catch {
      return base.slice(0, 28);
    }
  }

  function envLabel() {
    const override = localStorage.getItem('api_base');
    const label = apiBaseLabel();
    const host = apiHostLabel();
    const envName = label === 'prod' ? 'Production' : label === 'staging' ? 'Staging' : label === 'local' ? 'Local' : label;
    return { envName, host, warn: !!override };
  }

  function renderEnvBadge() {
    const { envName, host, warn } = envLabel();
    const el = document.getElementById('adminEnvPill');
    if (!el) return;
    el.innerHTML = `<span class="admin-crm-env-dot"></span> ${esc(envName)} · ${esc(host)}`;
    el.classList.toggle('warn', warn);
    el.title = warn
      ? `Using localStorage.api_base override: ${localStorage.getItem('api_base')}`
      : (window.API_BASE || 'same-origin');
  }

  async function loadNavBadges() {
    if (!hasCapability('platform.leads') && !hasCapability('platform.tenants')) return;
    try {
      const tasks = [];
      if (hasCapability('platform.leads')) {
        tasks.push(
          apiFetch('/api/admin/scrape/status').then((r) => {
            navBadges.pipeline = (r.leads?.needs_phone || 0) + (r.leads?.verified || 0);
          }).catch(() => {})
        );
      }
      if (hasCapability('platform.tenants')) {
        tasks.push(
          apiFetch('/api/admin/tenants/alerts').then((r) => {
            navBadges.tenants = r.clinic_count ?? (r.grouped_alerts || r.alerts || []).length;
          }).catch(() => {})
        );
      }
      await Promise.all(tasks);
      document.querySelectorAll('[data-nav-badge]').forEach((badge) => {
        const key = badge.dataset.navBadge;
        const n = navBadges[key];
        if (n > 0) {
          badge.textContent = n > 99 ? '99+' : String(n);
          badge.style.display = '';
        } else {
          badge.style.display = 'none';
        }
      });
    } catch { /* optional */ }
  }

  let rateLimitToastShown = false;

  function rateLimitMessage(resp) {
    const retryAfter = resp.headers.get('Retry-After');
    if (retryAfter) {
      const secs = parseInt(retryAfter, 10);
      if (Number.isFinite(secs) && secs > 0) {
        return `Rate limited — wait ${secs} seconds and retry`;
      }
    }
    const reset = resp.headers.get('RateLimit-Reset');
    if (reset) {
      const resetMs = parseInt(reset, 10) * 1000;
      if (Number.isFinite(resetMs)) {
        const waitSecs = Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));
        return `Rate limited — wait ${waitSecs} seconds and retry`;
      }
    }
    return 'Rate limited — wait a moment and retry';
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
    if (resp.status === 429) {
      const msg = rateLimitMessage(resp);
      if (!rateLimitToastShown) {
        rateLimitToastShown = true;
        showToast(msg, 'warning', 8000);
        setTimeout(() => { rateLimitToastShown = false; }, 15000);
      }
      throw new Error(msg);
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

    const link = (item) => {
      const active = item.id === activeId ? ' active' : '';
      const badge = item.badgeKey
        ? `<span class="admin-crm-nav-badge" data-nav-badge="${item.badgeKey}" style="display:none;"></span>`
        : '';
      const target = item.external ? ' target="_blank" rel="noopener"' : '';
      const capAttr = item.capability ? ` data-require-capability="${item.capability}"` : '';
      return `<a href="${item.href}" class="admin-crm-nav${active}"${target}${capAttr}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${item.icon}</svg>
        <span>${esc(item.label)}</span>
        ${badge}
      </a>`;
    };

    const workspace = NAV.filter((n) => n.group === 'workspace');
    const shortcuts = NAV.filter((n) => n.group === 'shortcuts');

    el.className = 'admin-crm-sidebar';
    el.innerHTML = `
      <a href="/" class="admin-crm-brand" title="callsomo.com">
        <img src="/assets/brand/somo-icon.png" alt="Somo" class="admin-crm-brand-mark" width="32" height="32">
        <div>
          <div class="admin-crm-brand-name">Somo</div>
          <div class="admin-crm-brand-sub">Admin</div>
        </div>
      </a>
      <div class="admin-crm-nav-group">
        <div class="admin-crm-nav-label">Workspace</div>
        ${workspace.map(link).join('')}
      </div>
      <div class="admin-crm-nav-group">
        <div class="admin-crm-nav-label">Shortcuts</div>
        ${shortcuts.map(link).join('')}
      </div>
      <div class="admin-crm-sidebar-spacer"></div>
      <div class="admin-crm-sidebar-foot">
        <div class="admin-crm-env-pill" id="adminEnvPill"></div>
        <div class="admin-crm-op-row">
          <div class="admin-crm-op-avatar" id="adminOpAvatar">O</div>
          <div>
            <div class="admin-crm-op-name" id="adminOpName">Operator</div>
            <div class="admin-crm-op-role">Admin</div>
          </div>
        </div>
      </div>`;
    renderEnvBadge();
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

  const INFO_ICON = '<svg class="admin-crm-suggestion-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>';

  function getDismissedSuggestions() {
    try {
      return JSON.parse(sessionStorage.getItem('admin_dismissed_suggestions') || '[]');
    } catch {
      return [];
    }
  }

  function dismissSuggestion(id) {
    const dismissed = getDismissedSuggestions();
    if (!dismissed.includes(id)) dismissed.push(id);
    sessionStorage.setItem('admin_dismissed_suggestions', JSON.stringify(dismissed));
    document.getElementById('adminSuggestionsStrip')?.remove();
    loadSuggestions();
  }

  async function loadSuggestions() {
    if (!hasCapability('platform.leads')) return;
    try {
      const r = await apiFetch('/api/admin/ai/suggestions');
      const dismissed = new Set(getDismissedSuggestions());
      const suggestions = (r.suggestions || []).filter((s, i) => {
        const id = `${s.type || 'tip'}-${i}-${(s.message || '').slice(0, 32)}`;
        s._sid = id;
        return !dismissed.has(id);
      });
      if (!suggestions.length) {
        document.getElementById('adminSuggestionsStrip')?.remove();
        return;
      }

      let strip = document.getElementById('adminSuggestionsStrip');
      if (!strip) {
        strip = document.createElement('div');
        strip.id = 'adminSuggestionsStrip';
        strip.className = 'admin-crm-suggestions-card';
        const main = document.querySelector('.admin-crm-main');
        if (main) main.insertBefore(strip, main.firstChild);
      }

      strip.innerHTML = suggestions.map((s) => {
        const id = s._sid;
        let body = esc(s.message || '');
        let action = '';
        if (s.type === 'enrich') {
          action = `<a href="/admin/pipeline.html#needs-phone" class="admin-crm-suggestion-link">Open queue</a>`;
        } else if (s.type === 'call' && s.leads?.length) {
          const names = s.leads.map((l) => esc(l.clinic_name)).join(', ');
          body = `${body} (${names})`;
          action = `<a href="/admin/pipeline.html" class="admin-crm-suggestion-link">Call queue</a>`;
        }
        return `
          <div class="admin-crm-suggestion-row">
            ${INFO_ICON}
            <div class="admin-crm-suggestion-body"><strong>Suggestion:</strong> ${body} ${action}</div>
            <button type="button" class="admin-crm-suggestion-dismiss" aria-label="Dismiss" data-id="${id}">×</button>
          </div>`;
      }).join('');

      strip.querySelectorAll('.admin-crm-suggestion-dismiss').forEach((btn) => {
        btn.onclick = () => dismissSuggestion(btn.dataset.id);
      });
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
        loadNavBadges();
      } else if (hasCapability('platform.tenants')) {
        loadNavBadges();
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
    applyCapabilityGating,
    loadSession,
    dismissSuggestion,
    rateLimitMessage,
    get capabilities() { return capabilities.slice(); },
    isCallInFlight: (id) => callsInFlight.has(String(id)),
  };
})();
