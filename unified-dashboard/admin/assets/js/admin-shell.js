/**
 * Shared admin CRM shell — sidebar, API helpers
 */
(function () {
  const NAV = [
    { id: 'board', href: '/admin/', label: 'Control board', icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' },
    { id: 'pipeline', href: '/admin/pipeline.html', label: 'Sales pipeline', icon: '<path d="M3 6h18M3 12h14M3 18h9"/>' },
    { id: 'tenants', href: '/admin/tenants.html', label: 'Tenants', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
    { id: 'provider', href: '/business/today.html', label: 'Provider portal', icon: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>', bottom: true },
  ];

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function adminLoginUrl() {
    const origin = window.location.origin || '';
    const returnTo = encodeURIComponent(window.location.href);
    return `${origin}/login.html?redirect=${returnTo}&admin=1`;
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

  function initAdminShell(activeId) {
    document.body.classList.add('shell', 'admin-portal-body');
    renderSidebar(activeId);
  }

  window.AdminShell = {
    init: initAdminShell,
    apiFetch,
    esc,
    NAV,
    showAuthRequired,
    adminLoginUrl,
  };
})();
