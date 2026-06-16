/**
 * Provider portal shell — dark sidebar, badges, shared API helpers
 */
(function () {
  const API_BASE = () => window.API_BASE || (typeof window !== 'undefined' && window.location?.origin) || 'http://localhost:4000';

  const PORTAL_NAV_BASE = [
    { section: 'Workspace' },
    { id: 'today', label: 'Today', icon: 'home', href: 'today.html', badgeKey: 'today' },
    { id: 'calendar', label: 'Schedule', icon: 'calendar-days', href: 'calendar.html' },
    { id: 'patients', label: 'Patients', icon: 'user-group', href: 'patients.html' },
    { section: 'Revenue' },
    { id: 'revenue', label: 'Revenue', icon: 'chart-bar', href: 'revenue.html', badgeKey: 'revenue' },
    { section: 'AI Ops' },
    { id: 'agent', label: 'Voice Agent', icon: 'microphone', href: 'agent.html', accent: true },
    { id: 'profile', label: 'Settings', icon: 'user', href: 'settings.html', accent: true }
  ];

  const STAGE_CTA_HREF = {
    pre_registration: 'today.html',
    registration: 'patients.html',
    charge_capture: 'revenue.html?tab=claims',
    prior_authorization: 'revenue.html?tab=work',
    medical_coding: 'revenue.html?tab=claims&panel=create',
    cdi: 'revenue.html?tab=work',
    claim_submission: 'revenue.html?tab=claims',
    remittance_processing: 'revenue.html?tab=claims#remittance',
    follow_up_phone: 'agent.html',
    patient_collection: 'revenue.html?tab=payments',
    bill: 'revenue.html?tab=payments'
  };

  window.ppJourneyStageHref = function (stageId) {
    const key = String(stageId || '').trim().toLowerCase().replace(/\s+/g, '_');
    return resolveHref(STAGE_CTA_HREF[key] || 'revenue.html?tab=pipeline');
  };

  const ADMIN_NAV_ITEMS = [
    { section: 'Admin' },
    { id: 'leads', label: 'Leads', icon: 'phone', href: 'leads.html', capability: 'platform.leads' },
    { id: 'tenants', label: 'Tenants', icon: 'building-office', href: 'tenants.html', capability: 'platform.tenants' },
    { id: 'payor-review', label: 'Payor Review', icon: 'clipboard-document-list', href: 'payor-review.html' },
    { id: 'merge-review', label: 'Merge Review', icon: 'document-text', href: 'merge-review.html' },
    { id: 'feature-flags', label: 'Feature Flags', icon: 'cube', href: 'feature-flags.html', capability: 'platform.feature_flags' }
  ];

  function hasCapability(cap) {
    const customer = getCustomer();
    const caps = customer?.capabilities;
    if (Array.isArray(caps)) return caps.includes(cap);
    return false;
  }

  /**
   * @deprecated — break-glass admin portal only (__admin_session marker).
   */
  function isAdminUser() {
    try {
      const user = JSON.parse(sessionStorage.getItem('user') || '{}');
      const customer = getCustomer();
      return user.__admin_session === true || customer.__admin_session === true;
    } catch (_) { /* ignore */ }
    return false;
  }

  function getPortalNav() {
    const file = (window.location.pathname.split('/').pop() || '').split('?')[0];
    const isAdminPage = ['payor-review.html', 'merge-review.html', 'feature-flags.html', 'leads.html', 'tenants.html'].includes(file);
    if (isAdminPage && (hasCapability('platform.leads') || hasCapability('platform.tenants') || hasCapability('platform.feature_flags'))) {
      const gated = ADMIN_NAV_ITEMS.filter((item) => {
        if (!item.capability) return true;
        return hasCapability(item.capability);
      });
      return PORTAL_NAV_BASE.concat(gated);
    }
    if (hasCapability('platform.leads') || hasCapability('platform.tenants')) {
      const gated = ADMIN_NAV_ITEMS.filter((item) => !item.capability || hasCapability(item.capability));
      return PORTAL_NAV_BASE.concat(gated);
    }
    return PORTAL_NAV_BASE;
  }

  const PORTAL_NAV = PORTAL_NAV_BASE;

  window.PORTAL_BADGES = { today: 0, revenue: 0, claims: 0, priorAuth: 0, exceptions: 0, payments: 0 };
  const paymentRefreshHandlers = new Set();
  let paymentPollTimer = null;

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
  window.__ppKellyStatus = null;

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

  const EMOJI_ICON_MAP = {
    '📞': 'phone',
    '🎤': 'microphone',
    '📄': 'document-text',
    '🧾': 'document-text',
    '📅': 'calendar-days',
    '📆': 'calendar-days',
    '📊': 'chart-bar',
    '📋': 'clipboard-document-list',
    '💰': 'banknotes',
    '💳': 'credit-card',
    '📱': 'device-phone-mobile',
    '👥': 'user-group',
    '👤': 'user',
    '🩺': 'heart',
    '🔔': 'bell',
    '🔒': 'lock-closed',
    '🔌': 'link',
    '🏥': 'building-office-2',
    '🏪': 'building-office-2',
    '⚙': 'cog-6-tooth',
    '⚠': 'exclamation-triangle',
    '🎛': 'adjustments-horizontal',
    '⚙': 'cog-6-tooth',
    '🚪': 'arrow-left-on-rectangle',
    '✕': 'x-mark',
    '❌': 'x-mark',
    '🔄': 'arrow-path',
    '🔍': 'magnifying-glass',
    '📹': 'video-camera',
    '🎥': 'video-camera',
    '🤖': 'sparkles',
    '📨': 'envelope',
    '💾': 'archive-box',
    '👁': 'eye'
  };

  function iconHtml(name) {
    return (typeof window.getNavIcon === 'function' ? window.getNavIcon(name) : '') || '';
  }

  function normalizeEmojiUi() {
    const selector = [
      'button', 'a', 'h1', 'h2', 'h3', 'h4', 'span',
      '.section-title', '.empty-state-icon', '.stat-icon', '.search-icon',
      '.nav-icon', '.logout-btn', '.tab', '.agent-action-btn span'
    ].join(',');
    document.querySelectorAll(selector).forEach((el) => {
      if (el.closest('#patientsRosterGrid, .pp-panel-body--patients, .pp-patients-search, .pp-patients-empty')
          || el.classList.contains('pp-search-icon')) {
        return;
      }
      // Never rewrite container divs (e.g. .pp-panel-body); aggregated textContent can
      // start with a child emoji and wipe the whole roster/search DOM.
      if (el.tagName === 'DIV' && el.children.length > 0
          && !el.classList.contains('empty-state-icon')
          && !el.classList.contains('stat-icon')
          && !el.classList.contains('search-icon')) {
        return;
      }
      const raw = (el.textContent || '').trim();
      if (!raw) return;
      const first = Array.from(raw)[0];
      const iconName = EMOJI_ICON_MAP[first];
      if (!iconName) return;

      if (el.classList.contains('empty-state-icon') || el.classList.contains('stat-icon') || el.classList.contains('search-icon')) {
        el.classList.add('pp-inline-icon-only');
        el.innerHTML = iconHtml(iconName);
        return;
      }

      const remainder = raw.slice(first.length).trim();
      if (!remainder) {
        el.classList.add('pp-inline-icon-only');
        el.innerHTML = iconHtml(iconName);
        return;
      }
      el.innerHTML = `<span class="pp-inline-icon" aria-hidden="true">${iconHtml(iconName)}</span><span>${remainder}</span>`;
      el.classList.add('pp-inline-iconized');
    });
  }

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
      const rb = m.revenue_badges;
      window.PORTAL_BADGES.revenue = Number(rb?.sidebar || 0);
      window.PORTAL_BADGES.exceptions = Number(m.exceptions_pending || 0);
      window.PORTAL_BADGES.priorAuth = Number(m.prior_auth?.pending || 0);
      window.PORTAL_BADGES.claims = Number(m.claims?.submitted || 0);
      window.PORTAL_BADGES.payments = Number(rb?.tabs?.payments || 0);
      window.PORTAL_BADGES.today = window.PORTAL_BADGES.revenue || window.PORTAL_BADGES.exceptions;
      window.__ppRevenueTabBadges = rb;
      if (typeof window.updateRevenueTabBadges === 'function') window.updateRevenueTabBadges(rb);
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
    if (typeof window.ensureProviderSidebarChrome === 'function') {
      window.ensureProviderSidebarChrome();
    }
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
  }

  function renderKellyStatus(status) {
    const agentLbl = document.getElementById('ppKellyLabel');
    const agentSub = document.getElementById('ppKellySub');
    const agentPhone = document.getElementById('ppKellyPhone');
    const toggle = document.getElementById('ppKellyToggle');
    const dot = document.querySelector('.pp-kelly-dot');
    const shellCard = document.getElementById('ppKellyLive');
    if (!agentLbl || !agentSub || !toggle || !shellCard) return;

    const state = String(status?.status || 'pending').toLowerCase();
    const provisioning = String(status?.provisioning_state || 'requested').toLowerCase();
    const label = agentLabel();
    const active = state === 'active';

    agentLbl.textContent = `${label} ${active ? 'is active' : state === 'paused' ? 'is paused' : 'is provisioning'}`;
    agentSub.textContent = provisioning === 'ready'
      ? 'Voice · scheduling · RCM'
      : provisioning === 'failed'
        ? 'Provisioning issue detected'
        : 'Provisioning in progress';
    if (agentPhone) agentPhone.textContent = status?.phone_number ? status.phone_number : 'Phone assignment pending';
    toggle.textContent = active ? 'Pause' : 'Activate';
    toggle.dataset.enabled = active ? '1' : '0';

    shellCard.classList.remove('kelly-active', 'kelly-paused', 'kelly-provisioning', 'kelly-error');
    shellCard.classList.add(
      state === 'active' ? 'kelly-active'
        : state === 'paused' ? 'kelly-paused'
          : provisioning === 'failed' || state === 'error' ? 'kelly-error'
            : 'kelly-provisioning'
    );
    if (dot) dot.classList.toggle('paused', !active);
  }

  window.__ppAlertItems = [];

  function ppEscapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  window.ppClearAlerts = function ppClearAlerts() {
    window.__ppAlertItems = [];
    const strip = document.getElementById('ppAlertStrip');
    if (strip) {
      strip.innerHTML = '';
      strip.hidden = true;
    }
    const legacy = document.getElementById('ppProvisionBanner');
    if (legacy) legacy.remove();
  };

  window.ppPushAlert = function ppPushAlert(item) {
    if (!item || !item.id) return;
    const idx = window.__ppAlertItems.findIndex((a) => a.id === item.id);
    if (idx >= 0) window.__ppAlertItems[idx] = item;
    else window.__ppAlertItems.push(item);
  };

  window.ppFlushAlertStrip = function ppFlushAlertStrip() {
    const strip = document.getElementById('ppAlertStrip');
    if (!strip) return false;
    const items = window.__ppAlertItems || [];
    if (!items.length) {
      strip.innerHTML = '';
      strip.hidden = true;
      return false;
    }
    strip.hidden = false;
    const icon = (name) => (typeof window.getNavIcon === 'function' ? window.getNavIcon(name) : '');
    strip.innerHTML = items.slice(0, 3).map((a) => {
      const href = a.href ? resolveHref(a.href) : '';
      const type = ['info', 'action', 'risk', 'success'].includes(a.type) ? a.type : 'info';
      return `
        <div class="pp-alert pp-alert--${type}" role="status">
          <span class="pp-alert-icon" aria-hidden="true">${icon(a.icon || 'exclamation-triangle')}</span>
          <span class="pp-alert-text">${ppEscapeHtml(a.message || '')}</span>
          ${href ? `<a class="pp-alert-cta" href="${ppEscapeHtml(href)}">${ppEscapeHtml(a.ctaLabel || 'Open')}</a>` : ''}
        </div>`;
    }).join('');
    return true;
  };

  window.ppRenderProvisioningAlert = function ppRenderProvisioningAlert(status) {
    const state = String(status?.provisioning_state || '').toLowerCase();
    const kellyStatus = String(status?.status || '').toLowerCase();
    if (!state || state === 'ready' || (kellyStatus === 'active' && state === 'ready')) {
      if (window.__ppAlertItems) {
        window.__ppAlertItems = window.__ppAlertItems.filter((a) => a.id !== 'kelly-provision');
      }
      const legacy = document.getElementById('ppProvisionBanner');
      if (legacy) legacy.remove();
      if (document.getElementById('ppAlertStrip')) window.ppFlushAlertStrip();
      return;
    }
    const failed = state === 'failed';
    window.ppPushAlert({
      id: 'kelly-provision',
      type: failed ? 'risk' : 'info',
      icon: 'microphone',
      message: failed
        ? 'Kelly provisioning needs attention. Retry from Settings or contact support.'
        : 'Kelly is provisioning your clinic phone and voice workflow.',
      href: 'agent.html',
      ctaLabel: 'Voice agent'
    });
    if (document.getElementById('ppAlertStrip')) {
      window.ppFlushAlertStrip();
      return;
    }
    const main = document.getElementById('ppMainContent');
    if (!main) return;
    const existing = document.getElementById('ppProvisionBanner');
    if (existing) existing.remove();
    const banner = document.createElement('div');
    banner.id = 'ppProvisionBanner';
    banner.className = `pp-provision-banner ${failed ? 'error' : 'pending'}`;
    banner.textContent = failed
      ? 'Kelly provisioning needs attention. Retry from Settings or contact support.'
      : 'Kelly is provisioning your clinic phone and voice workflow.';
    main.insertBefore(banner, main.firstChild);
  };

  function renderProvisioningBanner(status) {
    window.ppRenderProvisioningAlert(status);
  }

  async function fetchKellyStatus() {
    try {
      const res = await fetch(`${API_BASE()}/api/kelly/status`, {
        credentials: 'include',
        headers: getAuthHeaders()
      });
      if (!res.ok) return null;
      const json = await res.json();
      if (!json.success) return null;
      window.__ppKellyStatus = json;
      renderKellyStatus(json);
      renderProvisioningBanner(json);
      return json;
    } catch (e) {
      console.warn('[provider-shell] kelly status:', e.message);
      return null;
    }
  }

  async function toggleKelly() {
    const toggle = document.getElementById('ppKellyToggle');
    if (!toggle) return;
    const currentlyEnabled = toggle.dataset.enabled === '1';
    toggle.disabled = true;
    try {
      const res = await fetch(`${API_BASE()}/api/kelly/toggle`, {
        method: 'PATCH',
        credentials: 'include',
        headers: getAuthHeaders(),
        body: JSON.stringify({ enabled: !currentlyEnabled })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success) {
        window.__ppKellyStatus = json;
        renderKellyStatus(json);
        renderProvisioningBanner(json);
      }
    } catch (e) {
      console.warn('[provider-shell] kelly toggle:', e.message);
    } finally {
      toggle.disabled = false;
    }
  }

  function portalNavFlatItems() {
    return getPortalNav().filter((item) => item.id && item.href);
  }

  function updatePaymentNavBadge(payments) {
    const cutoff = Date.now() - 30 * 60 * 1000;
    const recent = (payments || []).filter((p) => {
      const st = String(p.status || '').toLowerCase();
      if (!['requested', 'sent', 'pending'].includes(st)) return false;
      const t = new Date(p.requested_at || p.created_at || 0).getTime();
      return !Number.isNaN(t) && t >= cutoff;
    });
    window.PORTAL_BADGES.payments = recent.length;
    const activeEl = document.querySelector('.pp-nav-item.active');
    const activeId = activeEl ? activeEl.getAttribute('data-nav-id') : null;
    if (activeId) renderProviderSidebar(activeId);
  }

  window.ppToast = function (message, type) {
    let el = document.getElementById('ppToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ppToast';
      el.className = 'pp-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.className = `pp-toast pp-toast--${type || 'info'} show`;
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.remove('show'), 2800);
  };

  window.ppOnPaymentRefresh = function (fn) {
    if (typeof fn === 'function') paymentRefreshHandlers.add(fn);
    return () => paymentRefreshHandlers.delete(fn);
  };

  window.ppNotifyPaymentRefresh = function (payments) {
    paymentRefreshHandlers.forEach((fn) => {
      try { fn(payments); } catch (_) { /* ignore */ }
    });
    updatePaymentNavBadge(payments);
  };

  window.ppStartPaymentPoll = function (intervalMs) {
    if (paymentPollTimer) return;
    const ms = Math.max(8000, Number(intervalMs) || 15000);
    const tick = async () => {
      try {
        const payments = await window.ppFetchRecentPayments(25);
        window.__ppLastPayments = payments;
        window.ppNotifyPaymentRefresh(payments);
      } catch (_) { /* ignore */ }
    };
    tick();
    paymentPollTimer = setInterval(tick, ms);
  };

  window.ppStopPaymentPoll = function () {
    if (paymentPollTimer) clearInterval(paymentPollTimer);
    paymentPollTimer = null;
  };

  function initProviderShell(options = {}) {
    if (typeof window.requireAuth === 'function') {
      const user = window.requireAuth(options.loginPath || '../login.html');
      if (!user) return;
    }
    const file = (window.location.pathname.split('/').pop() || '').split('?')[0];
    const PAGE_CAPABILITY_MAP = {
      'payor-review.html': 'platform.leads',
      'merge-review.html': 'platform.leads',
      'feature-flags.html': 'platform.feature_flags',
      'leads.html': 'platform.leads',
      'tenants.html': 'platform.tenants',
      'admin-billing.html': 'platform.tenants'
    };

    const requiredCap = PAGE_CAPABILITY_MAP[file];
    if (requiredCap && !hasCapability(requiredCap)) {
      console.warn(`[shell] Access denied to ${file}: missing capability ${requiredCap}`);
      window.location.replace(resolveHref('today.html'));
      return;
    }
    const activeId = options.activeId || 'today';
    document.body.classList.add('provider-portal');

    if (typeof window.ensureProviderSidebarChrome === 'function') {
      window.ensureProviderSidebarChrome();
    }
    renderProviderSidebar(activeId);
    fetchPortalBadges().then(() => renderProviderSidebar(activeId));

    const dateChip = document.getElementById('ppDateChip');
    if (dateChip) dateChip.textContent = formatDateChip();

    const title = document.getElementById('ppPageTitle');
    const heroGreeting = document.getElementById('ppHeroGreeting');
    const hasHeroGreeting = !!heroGreeting;

    if (heroGreeting && options.useGreeting !== false && !options.title) {
      heroGreeting.textContent = greetingName();
    } else if (title && options.title) {
      title.textContent = options.title;
    } else if (title && options.useGreeting === true && !hasHeroGreeting) {
      title.textContent = greetingName();
    } else if (title && !options.title && options.useGreeting !== false && activeId === 'today' && !hasHeroGreeting) {
      title.textContent = greetingName();
    }

    const eyebrow = document.getElementById('ppPageEyebrow');
    if (eyebrow && options.eyebrow) eyebrow.textContent = options.eyebrow;

    const sub = document.getElementById('ppPageSub');
    if (sub) {
      if (options.subtitle) {
        sub.textContent = options.subtitle;
        sub.hidden = false;
      } else {
        sub.textContent = '';
        sub.hidden = true;
      }
    }

    const toggle = document.getElementById('ppMobileToggle');
    const sidebar = document.getElementById('ppSidebar');
    if (toggle && sidebar && !toggle.dataset.boundMobile) {
      toggle.dataset.boundMobile = '1';
      let backdrop = document.getElementById('ppSidebarBackdrop');
      if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.id = 'ppSidebarBackdrop';
        backdrop.className = 'pp-sidebar-backdrop';
        backdrop.setAttribute('aria-hidden', 'true');
        document.body.appendChild(backdrop);
      }
      const closeSidebar = () => {
        sidebar.classList.remove('open');
        document.body.classList.remove('pp-sidebar-open');
        toggle.setAttribute('aria-expanded', 'false');
        backdrop.classList.remove('active');
      };
      const openSidebar = () => {
        sidebar.classList.add('open');
        document.body.classList.add('pp-sidebar-open');
        toggle.setAttribute('aria-expanded', 'true');
        backdrop.classList.add('active');
      };
      toggle.addEventListener('click', () => {
        if (sidebar.classList.contains('open')) closeSidebar();
        else openSidebar();
      });
      backdrop.addEventListener('click', closeSidebar);
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar();
      });
    }

    const kelly = document.getElementById('ppKellyLive');
    if (kelly && !kelly.href) {
      kelly.href = resolveHref('agent.html');
    }
    const kellyToggle = document.getElementById('ppKellyToggle');
    if (kellyToggle && !kellyToggle.dataset.bound) {
      kellyToggle.dataset.bound = '1';
      kellyToggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleKelly();
      });
    }
    fetchKellyStatus();

    const clinicCard = document.getElementById('ppClinicCard');
    if (clinicCard && !clinicCard.href) {
      clinicCard.href = resolveHref('settings.html');
    }
    normalizeEmojiUi();
    if (options.paymentPoll !== false) window.ppStartPaymentPoll(options.paymentPollMs || 15000);
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
  window.ppFetchKellyStatus = fetchKellyStatus;

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

  function ymdFromDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function sortAppointmentsAsc(list) {
    return (list || []).slice().sort((a, b) => {
      const sa = window.ppWallClockStart(a);
      const sb = window.ppWallClockStart(b);
      return (sa ? sa.getTime() : 0) - (sb ? sb.getTime() : 0);
    });
  }

  window.ppWeekAppointmentRanges = function ppWeekAppointmentRanges() {
    const endThis = new Date();
    const startThis = new Date();
    startThis.setDate(endThis.getDate() - 6);
    const endLast = new Date(startThis);
    endLast.setDate(endLast.getDate() - 1);
    const startLast = new Date(endLast);
    startLast.setDate(startLast.getDate() - 6);
    return {
      thisWeek: { start: ymdFromDate(startThis), end: ymdFromDate(endThis) },
      lastWeek: { start: ymdFromDate(startLast), end: ymdFromDate(endLast) }
    };
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
    return sortAppointmentsAsc(data.appointments || []);
  };

  window.ppFetchAppointmentsRange = async function (startDate, endDate) {
    const params = new URLSearchParams();
    params.append('clinic_id', getClinicId());
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    const res = await fetch(`${API_BASE()}/api/admin/appointments?${params}`, {
      credentials: 'include',
      cache: 'no-store'
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to load appointments');
    return sortAppointmentsAsc(data.appointments || []);
  };

  window.ppFetchAppointmentsUpcoming = async function (limit = 25) {
    const params = new URLSearchParams();
    params.append('clinic_id', getClinicId());
    params.append('limit', String(limit));
    const res = await fetch(`${API_BASE()}/api/admin/appointments/upcoming?${params}`, {
      credentials: 'include',
      cache: 'no-store'
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to load upcoming appointments');
    return sortAppointmentsAsc(data.appointments || []);
  };

  window.ppFetchAppointmentsRecent = async function (days = 14) {
    const end = new Date();
    end.setDate(end.getDate() - 1);
    const start = new Date();
    start.setDate(start.getDate() - days);
    const list = await window.ppFetchAppointmentsRange(ymdFromDate(start), ymdFromDate(end));
    const today = todayYmd();
    return list
      .filter((a) => String(a.date || '').slice(0, 10) < today)
      .sort((a, b) => {
        const sa = window.ppWallClockStart(a);
        const sb = window.ppWallClockStart(b);
        return (sb ? sb.getTime() : 0) - (sa ? sa.getTime() : 0);
      });
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

  window.ppFetchRcmJourneys = async function (limit = 8) {
    const url = new URL(`${API_BASE()}/api/rcm/journeys`);
    url.searchParams.set('clinic_id', getClinicId());
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('status', 'open');
    const res = await fetch(url.toString(), {
      credentials: 'include',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.success && Array.isArray(json.journeys) ? json.journeys : [];
  };

  window.ppFetchPatientContext = async function (patientIds) {
    const ids = (patientIds || []).filter(Boolean).slice(0, 50);
    if (!ids.length) return {};
    const url = new URL(`${API_BASE()}/api/rcm/patient-context`);
    url.searchParams.set('clinic_id', getClinicId());
    url.searchParams.set('patient_ids', ids.join(','));
    const res = await fetch(url.toString(), {
      credentials: 'include',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.success && json.context ? json.context : {};
  };

  window.ppResendViaKelly = async function ({ journeyId, patientId, amount, delivery = 'both' }) {
    if (!journeyId) throw new Error('journey_id is required');
    const url = new URL(`${API_BASE()}/api/rcm/collection-queue/${encodeURIComponent(journeyId)}/resend`);
    url.searchParams.set('clinic_id', getClinicId());
    const res = await fetch(url.toString(), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({
        clinic_id: getClinicId(),
        patient_id: patientId || undefined,
        amount: amount != null ? Number(amount) : undefined,
        delivery,
      }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  };

  window.ppFetchPaymentSummary = async function () {
    const url = new URL(`${API_BASE()}/api/rcm/payments/summary`);
    url.searchParams.set('clinic_id', getClinicId());
    const res = await fetch(url.toString(), {
      credentials: 'include',
      headers: getAuthHeaders()
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.success ? json.summary : null;
  };

  window.ppFetchCommandCenter = async function () {
    const url = new URL(`${API_BASE()}/api/rcm/command-center`);
    url.searchParams.set('clinic_id', getClinicId());
    const res = await fetch(url.toString(), {
      credentials: 'include',
      headers: getAuthHeaders()
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.success ? json : null;
  };

  window.ppFetchRecentPayments = async function (limit = 10) {
    const url = new URL(`${API_BASE()}/api/rcm/payments`);
    url.searchParams.set('clinic_id', getClinicId());
    url.searchParams.set('limit', String(limit));
    const res = await fetch(url.toString(), {
      credentials: 'include',
      headers: getAuthHeaders()
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json.success && Array.isArray(json.payments) ? json.payments : [];
  };

  window.ppFetchKellyActivity = async function (limit = 20, since) {
    const url = new URL(`${API_BASE()}/api/kelly/activity`);
    url.searchParams.set('clinic_id', getClinicId());
    url.searchParams.set('limit', String(limit));
    if (since) url.searchParams.set('since', String(since));
    const res = await fetch(url.toString(), {
      credentials: 'include',
      headers: getAuthHeaders()
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json.success && Array.isArray(json.activity) ? json.activity : [];
  };

  const STAGE_CHIP_LABELS = {
    pre_registration: 'Intake in progress',
    registration: 'Registration',
    charge_capture: 'Create claim',
    prior_authorization: 'PA pending',
    medical_coding: 'Ready to code',
    cdi: 'CDI review',
    claim_submission: 'Claim submitted',
    remittance_processing: 'Remittance',
    follow_up_phone: 'Follow up',
    patient_collection: 'Collection',
    bill: 'Invoice'
  };

  const JOURNEY_STAGE_TONE = {
    pre_registration: 't',
    registration: 't',
    charge_capture: 'a',
    prior_authorization: 'a',
    medical_coding: 'a',
    cdi: 'r',
    claim_submission: 'a',
    remittance_processing: 't',
    follow_up_phone: 'a',
    patient_collection: 'r',
    bill: 'a'
  };

  const JOURNEY_STAGE_ICON = {
    pre_registration: 'clipboard',
    registration: 'user-check',
    bill: 'clock',
    patient_collection: 'exclamation-triangle',
    follow_up_phone: 'phone',
    prior_authorization: 'document-text',
    cdi: 'exclamation-triangle',
    charge_capture: 'clipboard',
    medical_coding: 'clipboard',
    claim_submission: 'document-text',
    remittance_processing: 'banknotes'
  };

  function journeyChipToneClass(stage) {
    const tone = JOURNEY_STAGE_TONE[stage] || 't';
    if (tone === 'r') return 'pp-chip-r';
    if (tone === 'a') return 'pp-chip-a';
    return 'pp-chip-t';
  }

  function escapeChipText(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  window.ppRenderJourneyActionChip = function (journey) {
    const chip = window.ppJourneyStageChip(journey);
    if (!chip) return '';
    const stage = String(journey?.stage || '').trim().toLowerCase();
    const href = resolveHref(chip.href);
    const iconKey = JOURNEY_STAGE_ICON[stage] || 'clipboard';
    const icon =
      typeof window.getNavIcon === 'function' ? window.getNavIcon(iconKey) : '';
    const patientRef =
      journey.patient_name ||
      (journey.patient_id
        ? String(journey.patient_id).replace(/^Patient\//, '').slice(0, 12)
        : '');
    const suffix = patientRef ? ` · ${patientRef}` : '';
    const label = `${chip.label}${suffix}`;
    const cls = journeyChipToneClass(stage);
    return `<a class="pp-journey-chip--pill ${cls}" href="${escapeChipText(href)}"><span class="pp-inline-icon" aria-hidden="true">${icon}</span>${escapeChipText(label)}</a>`;
  };

  window.ppJourneyStageChip = function (journey) {
    if (!journey) return null;
    const stage = String(journey.stage || '').trim().toLowerCase();
    let label = STAGE_CHIP_LABELS[stage] || journey.stage_contract?.label || stage.replace(/_/g, ' ');
    if (stage === 'patient_collection' && journey.amount_due != null && Number(journey.amount_due) > 0) {
      label = `Copay due — $${Number(journey.amount_due).toFixed(2)}`;
    }
    const tone =
      stage === 'patient_collection' || stage === 'prior_authorization'
        ? 'warn'
        : stage === 'follow_up_phone'
          ? 'info'
          : 'action';
    return {
      label,
      href: window.ppJourneyStageHref(stage),
      tone,
      stage
    };
  };

  function railBadgeFromStatus(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'scheduled' || s === 'new') return { badge: 'New Booking', badgeType: 'green' };
    if (s === 'rescheduled') return { badge: 'Rescheduled', badgeType: 'orange' };
    if (s === 'confirmed') return { badge: 'Confirmed', badgeType: 'blue' };
    if (s === 'cancelled' || s === 'canceled') return { badge: 'Cancelled', badgeType: 'orange' };
    return null;
  }

  function normalizeRailItem(item, fallbackType) {
    const badgeInfo = item?.badge
      ? { badge: item.badge, badgeType: item.badgeType || 'green' }
      : railBadgeFromStatus(item?.status);
    return {
      id: String(item?.id || `${fallbackType}_${Date.now()}`),
      patient: item?.patient || 'Patient',
      time: item?.time || 'Now',
      timeRaw: item?.timeRaw || item?.created_at || item?.time,
      summary: item?.summary || '',
      status: item?.status || 'new',
      badge: badgeInfo?.badge,
      badgeType: badgeInfo?.badgeType,
      unread: Number(item?.unread || item?.unread_count || 0),
      cta: item?.cta || { label: 'Open', href: fallbackType === 'call' ? 'calendar.html' : 'patients.html' }
    };
  }

  window.ppFetchRecentCalls = async function (limit = 5) {
    const url = new URL(`${API_BASE()}/api/rcm/recent-calls`);
    url.searchParams.set('clinic_id', getClinicId());
    url.searchParams.set('limit', String(limit));
    const res = await fetch(url.toString(), {
      credentials: 'include',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Failed to load recent calls');
    const items = Array.isArray(json.items) ? json.items : [];
    return items.map((item) => normalizeRailItem(item, 'call'));
  };

  window.ppFetchRecentMessages = async function (limit = 5) {
    const url = new URL(`${API_BASE()}/api/rcm/recent-messages`);
    url.searchParams.set('clinic_id', getClinicId());
    url.searchParams.set('limit', String(limit));
    const res = await fetch(url.toString(), {
      credentials: 'include',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Failed to load recent messages');
    const items = Array.isArray(json.items) ? json.items : [];
    return items.map((item) => normalizeRailItem(item, 'message'));
  };

  window.ppPanelState = function (state, text, opts = {}) {
    const retry = opts.retry ? `<button type="button" class="pp-btn pp-btn-ghost pp-btn-sm" data-retry="${opts.retry}">Retry</button>` : '';
    if (state === 'loading') {
      return `<div class="pp-state pp-state-loading"><div class="pp-skeleton"></div><div class="pp-skeleton"></div></div>`;
    }
    if (state === 'error') {
      return `<div class="pp-state pp-state-error"><div>${text || 'Could not load this panel.'}</div>${retry}</div>`;
    }
    if (state === 'empty') {
      return `<div class="pp-state pp-state-empty">${text || 'Nothing to show yet.'}</div>`;
    }
    return '';
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

  window.hasCapability = hasCapability;
  window.isAdminUser = isAdminUser;

  if (typeof window.hydrateProviderSession === 'function') {
    window.hydrateProviderSession(API_BASE());
  }
})();
