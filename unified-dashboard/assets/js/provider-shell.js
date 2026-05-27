/**
 * Provider portal shell — dark sidebar, badges, shared API helpers
 */
(function () {
  const API_BASE = () => window.API_BASE || 'http://localhost:4000';

  const PORTAL_NAV_BASE = [
    { section: 'Workspace' },
    { id: 'today', label: 'Today', icon: 'home', href: 'today.html', badgeKey: 'today' },
    { id: 'calendar', label: 'Schedule', icon: 'calendar-days', href: 'calendar.html' },
    { id: 'patients', label: 'Patients', icon: 'user-group', href: 'patients.html' },
    { section: 'Revenue' },
    { id: 'claims', label: 'Claims & RCM', icon: 'clipboard-document-list', href: 'billing.html?section=overview', badgeKey: 'claims' },
    { id: 'prior-auth', label: 'Prior Auth', icon: 'document-text', href: 'billing.html?section=prior-auth', badgeKey: 'priorAuth' },
    { id: 'billing', label: 'Invoices', icon: 'banknotes', href: 'billing.html?section=invoices' },
    { section: 'AI Ops' },
    { id: 'agent', label: 'Voice Agent', icon: 'microphone', href: 'agent.html' },
    { id: 'exceptions', label: 'Exceptions', icon: 'clipboard-document-list', href: 'claims.html', badgeKey: 'exceptions' },
    { id: 'profile', label: 'Settings', icon: 'user', href: 'settings.html' }
  ];

  const ADMIN_NAV_ITEMS = [
    { section: 'Admin' },
    { id: 'payor-review', label: 'Payor Review', icon: 'clipboard-document-list', href: 'payor-review.html' },
    { id: 'merge-review', label: 'Merge Review', icon: 'document-text', href: 'merge-review.html' },
    { id: 'feature-flags', label: 'Feature Flags', icon: 'cube', href: 'feature-flags.html' }
  ];

  function isAdminUser() {
    try {
      const user = JSON.parse(sessionStorage.getItem('user') || '{}');
      const customer = getCustomer();
      const role = String(user.role || customer.role || '').toLowerCase();
      const email = String(user.email || customer.email || '').toLowerCase();
      if (role.includes('admin') || role === 'insurer_admin') return true;
      if (email === 'admin@doclittle.com' || email === 'insurer@doclittle.com') return true;
    } catch (_) { /* ignore */ }
    return false;
  }

  function getPortalNav() {
    if (isAdminUser()) return PORTAL_NAV_BASE.concat(ADMIN_NAV_ITEMS);
    return PORTAL_NAV_BASE;
  }

  const PORTAL_NAV = PORTAL_NAV_BASE;

  window.PORTAL_BADGES = { today: 0, claims: 0, priorAuth: 0, exceptions: 0 };

  function resolveHref(href) {
    if (typeof window.resolveBusinessPath === 'function') {
      return window.resolveBusinessPath(href);
    }
    return href;
  }

  function getClinicId() {
    const tc = window.TENANT_CONFIG || {};
    const customer = getCustomer();
    return customer.clinic_id || customer.clinicId || tc.clinic_id || 'clinic-default';
  }

  function getCustomer() {
    try {
      return JSON.parse(sessionStorage.getItem('customer') || '{}');
    } catch {
      return {};
    }
  }

  function getAuthHeaders() {
    const clinicId = getClinicId();
    const h = { 'Content-Type': 'application/json' };
    if (clinicId) h['x-clinic-id'] = clinicId;
    return h;
  }

  function clinicInitials(name) {
    if (!name) return 'CL';
    const parts = String(name).trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return String(name).slice(0, 2).toUpperCase();
  }

  function formatMoney(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function formatTime12(date) {
    if (!date || Number.isNaN(date.getTime())) return '—';
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  function todayYmd() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatDateChip() {
    const d = new Date();
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return `${days[d.getDay()]} · ${months[d.getMonth()]} ${d.getDate()} · ${d.getFullYear()}`;
  }

  function greetingName() {
    const user = typeof window.getUserData === 'function' ? window.getUserData() : {};
    const customer = getCustomer();
    const raw = user.name || user.first_name || customer.name || customer.contact_name || 'there';
    const first = String(raw).split(/\s+/)[0];
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    return `${greet}, ${first}`;
  }

  function agentLabel() {
    const tc = window.TENANT_CONFIG || {};
    return tc.voice_agent_name || tc.agent_name || 'Kelly';
  }

  function clinicDisplayName() {
    const c = getCustomer();
    const tc = window.TENANT_CONFIG || {};
    return c.company_name || c.clinic_name || tc.clinic_name || tc.sidebarSubtitle || 'Your clinic';
  }

  window.ppGetClinicId = getClinicId;
  window.ppGetAuthHeaders = getAuthHeaders;
  window.ppFormatMoney = formatMoney;
  window.ppTodayYmd = todayYmd;
  window.ppGreetingName = greetingName;
  window.ppAgentLabel = agentLabel;
  window.ppClinicDisplayName = clinicDisplayName;

  async function fetchPortalBadges() {
    try {
      const url = new URL(`${API_BASE()}/api/rcm/metrics/health`);
      const customer = getCustomer();
      if (customer.merchant_id) url.searchParams.set('merchant_id', customer.merchant_id);
      url.searchParams.set('clinic_id', getClinicId());
      const res = await fetch(url.toString(), {
        credentials: 'include',
        headers: getAuthHeaders()
      });
      if (!res.ok) return;
      const json = await res.json();
      if (!json.success || !json.metrics) return;
      const m = json.metrics;
      window.PORTAL_BADGES.exceptions = Number(m.exceptions_pending || 0);
      window.PORTAL_BADGES.priorAuth = Number(m.prior_auth?.pending || 0);
      window.PORTAL_BADGES.claims = Number(m.claims?.submitted || 0);
      window.PORTAL_BADGES.today = window.PORTAL_BADGES.exceptions;
    } catch (e) {
      console.warn('[provider-shell] badges:', e.message);
    }
  }

  function badgeHtml(key) {
    const n = window.PORTAL_BADGES[key];
    if (!n || n <= 0) return '';
    const cls = key === 'priorAuth' ? '' : key === 'claims' ? ' am' : key === 'exceptions' ? '' : ' am';
    return `<span class="pp-nav-badge${cls}">${n > 99 ? '99+' : n}</span>`;
  }

  function renderProviderSidebar(activeId) {
    const root = document.getElementById('ppSidebarNav');
    if (!root) return;

    const icon = (key) => (typeof window.getNavIcon === 'function' ? window.getNavIcon(key) : '') || '';

    let html = '';
    for (const item of getPortalNav()) {
      if (item.section) {
        html += `<div class="pp-sb-section">${item.section}</div>`;
        continue;
      }
      const isActive = item.id === activeId;
      const href = resolveHref(item.href);
      html += `
        <a href="${href}" class="pp-nav-item${isActive ? ' active' : ''}" data-nav-id="${item.id}">
          <span class="pp-nav-icon">${icon(item.icon)}</span>
          <span>${item.label}</span>
          ${item.badgeKey ? badgeHtml(item.badgeKey) : ''}
        </a>`;
    }
    root.innerHTML = html;

    const clinicName = clinicDisplayName();
    const av = document.getElementById('ppClinicAv');
    const cn = document.getElementById('ppClinicName');
    const cr = document.getElementById('ppClinicRole');
    if (av) av.textContent = clinicInitials(clinicName);
    if (cn) cn.textContent = clinicName;
    if (cr) cr.textContent = (window.TENANT_CONFIG && window.TENANT_CONFIG.sidebarSubtitle) || 'Provider portal';

    const agentSub = document.getElementById('ppKellySub');
    const agentLbl = document.getElementById('ppKellyLabel');
    if (agentLbl) agentLbl.textContent = `${agentLabel()} is live`;
    if (agentSub) agentSub.textContent = 'Voice · scheduling · RCM';

    const logoSub = document.getElementById('ppLogoSub');
    if (logoSub) logoSub.textContent = `powered by ${agentLabel()}`;
  }

  function portalNavFlatItems() {
    return getPortalNav().filter((item) => item.id && item.href);
  }

  function initProviderShell(options = {}) {
    const activeId = options.activeId || 'today';
    document.body.classList.add('provider-portal');

    renderProviderSidebar(activeId);
    fetchPortalBadges().then(() => renderProviderSidebar(activeId));

    const dateChip = document.getElementById('ppDateChip');
    if (dateChip) dateChip.textContent = formatDateChip();

    const title = document.getElementById('ppPageTitle');
    if (title && options.title) title.textContent = options.title;

    const eyebrow = document.getElementById('ppPageEyebrow');
    if (eyebrow && options.eyebrow) eyebrow.textContent = options.eyebrow;

    if (title && options.useGreeting === true) {
      title.textContent = greetingName() + ' ✦';
    } else if (title && !options.title && options.useGreeting !== false && activeId === 'today') {
      title.textContent = greetingName() + ' ✦';
    }

    const toggle = document.getElementById('ppMobileToggle');
    const sidebar = document.getElementById('ppSidebar');
    if (toggle && sidebar) {
      toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    }

    const kelly = document.getElementById('ppKellyLive');
    if (kelly && !kelly.href) {
      kelly.href = resolveHref('agent.html');
    }

    const clinicCard = document.getElementById('ppClinicCard');
    if (clinicCard && !clinicCard.href) {
      clinicCard.href = resolveHref('settings.html');
    }
  }

  function initProviderPage(options = {}) {
    if (typeof window.mountProviderPage === 'function' && !document.getElementById('ppSidebar')) {
      window.mountProviderPage(options);
      return;
    }
    initProviderShell(options);
  }

  window.PORTAL_NAV = PORTAL_NAV_BASE;
  window.getPortalNav = getPortalNav;
  window.portalNavFlatItems = portalNavFlatItems;
  window.renderProviderSidebar = renderProviderSidebar;
  window.initProviderShell = initProviderShell;
  window.initProviderPage = initProviderPage;
  window.fetchPortalBadges = fetchPortalBadges;

  /** Match calendar wall-clock parsing */
  window.ppWallClockStart = function (a) {
    if (!a || !a.date || a.time == null || a.time === '') return null;
    const tm = String(a.time);
    const parts = tm.split(':');
    const hh = String(parts[0] || '0').padStart(2, '0');
    const mm = String(parts[1] != null ? parts[1] : '0').padStart(2, '0');
    const ss = parts[2] != null ? String(parts[2]).padStart(2, '0') : '00';
    const isoLocal = `${String(a.date).slice(0, 10)}T${hh}:${mm}:${ss}`;
    const start = new Date(isoLocal);
    if (Number.isNaN(start.getTime())) return null;
    return start;
  };

  window.ppFetchAppointmentsToday = async function () {
    const params = new URLSearchParams();
    params.append('clinic_id', getClinicId());
    params.append('date', todayYmd());
    const res = await fetch(`${API_BASE()}/api/admin/appointments?${params}`, {
      credentials: 'include',
      cache: 'no-store'
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to load appointments');
    const list = data.appointments || [];
    list.sort((a, b) => {
      const sa = window.ppWallClockStart(a);
      const sb = window.ppWallClockStart(b);
      return (sa ? sa.getTime() : 0) - (sb ? sb.getTime() : 0);
    });
    return list;
  };

  window.ppFetchRcmExceptions = async function () {
    const url = new URL(`${API_BASE()}/api/rcm/exceptions`);
    const customer = getCustomer();
    if (customer.merchant_id) url.searchParams.set('merchant_id', customer.merchant_id);
    url.searchParams.set('clinic_id', getClinicId());
    const res = await fetch(url.toString(), {
      credentials: 'include',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.success && Array.isArray(json.items) ? json.items : [];
  };

  window.ppFetchRcmMetrics = async function () {
    const url = new URL(`${API_BASE()}/api/rcm/metrics/health`);
    const customer = getCustomer();
    if (customer.merchant_id) url.searchParams.set('merchant_id', customer.merchant_id);
    url.searchParams.set('clinic_id', getClinicId());
    const res = await fetch(url.toString(), {
      credentials: 'include',
      headers: getAuthHeaders()
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.success ? json.metrics : null;
  };

  window.ppFetchPriorAuthRequests = async function (status) {
    const url = new URL(`${API_BASE()}/api/prior-auth/requests`);
    url.searchParams.set('clinic_id', getClinicId());
    if (status) url.searchParams.set('status', status);
    const res = await fetch(url.toString(), {
      credentials: 'include',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.success && Array.isArray(json.requests) ? json.requests : [];
  };

  window.ppOpenModal = function (id) {
    const overlay = document.getElementById('ppModalOverlay');
    const modal = document.getElementById(id);
    if (!overlay || !modal) return;
    document.querySelectorAll('.pp-modal-panel').forEach((m) => {
      m.style.display = 'none';
    });
    modal.style.display = 'block';
    overlay.classList.add('open');
  };

  window.ppCloseModal = function (e) {
    if (e && e.target && e.target.id !== 'ppModalOverlay') return;
    const overlay = document.getElementById('ppModalOverlay');
    if (overlay) overlay.classList.remove('open');
    setTimeout(() => {
      document.querySelectorAll('.pp-modal-panel').forEach((m) => {
        m.style.display = 'none';
      });
    }, 200);
  };
})();
