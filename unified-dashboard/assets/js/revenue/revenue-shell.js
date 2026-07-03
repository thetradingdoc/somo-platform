/**
 * Revenue hub shell — tab routing and lazy mount
 */
(function () {
  const TABS = [
    { id: 'pipeline', label: 'Pipeline', badgeKey: 'pipeline', mount: () => window.mountPipelineTab },
    { id: 'claims', label: 'Claims', badgeKey: 'claims', mount: () => window.mountClaimsTab },
    { id: 'payments', label: 'Patient pay', badgeKey: 'payments', mount: () => window.mountPaymentsTab },
    { id: 'work', label: 'Work queue', badgeKey: 'work', mount: () => window.mountWorkTab },
  ];

  const mounted = new Set();

  function parseTabFromUrl() {
    const tab = new URLSearchParams(window.location.search).get('tab') || 'pipeline';
    return TABS.some((t) => t.id === tab) ? tab : 'pipeline';
  }

  function updateTabBadges(badges) {
    window.__ppRevenueTabBadges = badges || {};
    TABS.forEach((t) => {
      const el = document.getElementById(`rev-tab-badge-${t.id}`);
      if (!el) return;
      const n = Number(badges?.tabs?.[t.badgeKey] ?? badges?.[t.badgeKey] ?? 0);
      if (n > 0) {
        el.textContent = n > 99 ? '99+' : String(n);
        el.hidden = false;
      } else {
        el.hidden = true;
      }
    });
  }

  async function refreshRevenueBadges() {
    try {
      const url = new URL(`${window.API_BASE || ''}/api/rcm/metrics/health`);
      url.searchParams.set('clinic_id', window.ppGetClinicId?.() || 'clinic-default');
      const res = await fetch(url.toString(), {
        credentials: 'include',
        headers: window.ppGetAuthHeaders?.() || {},
      });
      if (!res.ok) return;
      const json = await res.json();
      const rb = json.metrics?.revenue_badges;
      if (rb) {
        updateTabBadges(rb);
        window.PORTAL_BADGES = window.PORTAL_BADGES || {};
        window.PORTAL_BADGES.revenue = Number(rb.sidebar || 0);
        const active = document.querySelector('.pp-nav-item.active')?.getAttribute('data-nav-id');
        if (active && typeof window.renderProviderSidebar === 'function') {
          window.renderProviderSidebar(active);
        }
      }
    } catch (_) { /* ignore */ }
  }

  function syncUrl(tabId) {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tabId);
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }

  async function mountTab(tabId) {
    const panel = document.getElementById(`ppRevenuePanel-${tabId}`);
    const tabDef = TABS.find((t) => t.id === tabId);
    if (!panel || !tabDef) return;
    if (mounted.has(tabId)) return;
    const mountFn = tabDef.mount();
    if (typeof mountFn === 'function') {
      await mountFn(panel);
      mounted.add(tabId);
    }
  }

  function switchRevenueTab(tabId, options) {
    const id = TABS.some((t) => t.id === tabId) ? tabId : 'pipeline';
    document.querySelectorAll('.pp-revenue-tab').forEach((el) => {
      const on = el.getAttribute('data-tab') === id;
      el.classList.toggle('active', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.pp-revenue-panel').forEach((el) => {
      el.hidden = el.id !== `ppRevenuePanel-${id}`;
    });
    if (options?.syncUrl !== false) syncUrl(id);
    mountTab(id);
  }

  function bindTabs() {
    document.querySelectorAll('.pp-revenue-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchRevenueTab(btn.getAttribute('data-tab'));
      });
    });
  }

  function mountRevenueChrome() {
    if (typeof window.mountProviderPage === 'function') {
      window.mountProviderPage({
        activeId: 'revenue',
        eyebrow: 'Revenue',
        title: 'Revenue hub',
        subtitle: 'Pipeline, claims, patient pay, and work queue.',
        topbarActions: '<a class="pp-btn pp-btn-outline pp-btn-sm" href="patients.html">Search patient</a>',
      });
      const topbar = document.querySelector('.pp-topbar');
      if (topbar && !topbar.querySelector('.pp-revenue-tabs')) {
        topbar.classList.add('pp-revenue-topbar');
        topbar.insertAdjacentHTML(
          'beforeend',
          `<div class="pp-revenue-tabs" role="tablist" aria-label="Revenue sections">
          <button type="button" class="pp-revenue-tab active" data-tab="pipeline" role="tab" aria-selected="true">Pipeline</button>
          <button type="button" class="pp-revenue-tab" data-tab="claims" role="tab" aria-selected="false">
            Claims <span class="pp-revenue-tab-badge" id="rev-tab-badge-claims" hidden></span>
          </button>
          <button type="button" class="pp-revenue-tab" data-tab="payments" data-testid="revenue-tab-payments" role="tab" aria-selected="false">
            Patient pay <span class="pp-revenue-tab-badge" id="rev-tab-badge-payments" hidden></span>
          </button>
          <button type="button" class="pp-revenue-tab" data-tab="work" role="tab" aria-selected="false">
            Work queue <span class="pp-revenue-tab-badge" id="rev-tab-badge-work" hidden></span>
          </button>
        </div>`
        );
      }
    } else if (typeof window.initProviderShell === 'function') {
      window.initProviderShell({ activeId: 'revenue', paymentPoll: true });
    }
  }

  function initRevenueHub() {
    mountRevenueChrome();
    bindTabs();
    const tab = parseTabFromUrl();
    switchRevenueTab(tab, { syncUrl: false });
    refreshRevenueBadges();
    setInterval(refreshRevenueBadges, 30000);
    if (window.location.hash === '#remittance') {
      const claimsPanel = document.getElementById('ppRevenuePanel-claims');
      claimsPanel?.querySelector('#remittance')?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  window.switchRevenueTab = switchRevenueTab;
  window.updateRevenueTabBadges = updateTabBadges;
  window.initRevenueHub = initRevenueHub;

  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.dataset.page === 'revenue') initRevenueHub();
  });
})();
