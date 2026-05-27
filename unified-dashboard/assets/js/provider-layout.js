/**
 * Mounts the shared FrontDesk provider shell on legacy business pages.
 * Call mountProviderPage({ activeId, eyebrow, title }) on DOMContentLoaded.
 */
(function () {
  const SIDEBAR_HTML = `
    <aside class="pp-sidebar" id="ppSidebar">
      <div class="pp-clinic-header">
        <div class="pp-sb-av" id="ppClinicAv">CL</div>
        <div>
          <div class="pp-sb-cn" id="ppClinicName">Clinic</div>
          <div class="pp-sb-cr" id="ppClinicRole">Provider</div>
        </div>
      </div>
      <nav class="pp-sb-nav" id="ppSidebarNav" aria-label="Main"></nav>
      <div class="pp-sb-footer">
        <a class="pp-sb-clinic" id="ppClinicCard" href="settings.html">
          <div class="pp-sb-av">CL</div>
          <div>
            <div class="pp-sb-cn">Clinic profile</div>
            <div class="pp-sb-cr">Manage provider details</div>
          </div>
        </a>
      </div>
    </aside>`;

  function resolveActiveIdFromUrl() {
    const file = (window.location.pathname.split('/').pop() || '').split('?')[0];
    const section = new URLSearchParams(window.location.search).get('section');
    if (file === 'today.html') return 'today';
    if (file === 'video-call.html') return 'calendar';
    if (file === 'patients.html' || file === 'patient-case.html') return 'patients';
    if (file === 'claims.html') return 'exceptions';
    if (file === 'agent.html') return 'agent';
    if (file === 'settings.html') return 'profile';
    if (file === 'rcm.html') return 'rcm';
    if (file === 'patient-payments.html') return 'payments';
    if (file === 'billing.html') {
      if (section === 'invoices') return 'billing';
      if (section === 'prior-auth') return 'prior-auth';
      if (section === 'claims') return 'claims';
      return 'claims';
    }
    if (file === 'pdf-coding.html') return 'claims';
    if (file === 'invoices.html' || file === 'invoice-detail.html') return 'billing';
    if (file === 'payor-review.html') return 'payor-review';
    if (file === 'merge-review.html') return 'merge-review';
    if (file === 'feature-flags.html') return 'feature-flags';
    return 'today';
  }

  function mountProviderPage(options = {}) {
    // #region agent log
    fetch('http://127.0.0.1:7543/ingest/a415f78f-06bc-471d-9251-324ff2e64d53',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4ae50e'},body:JSON.stringify({sessionId:'4ae50e',runId:'ui-audit-pre',hypothesisId:'H1',location:'provider-layout.js:60',message:'mountProviderPage_entry',data:{path:window.location.pathname,activeIdOption:options.activeId||null,bodyHasProviderClass:document.body.classList.contains('provider-portal')},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!document.getElementById('ppSidebarNav')) {
      document.body.classList.add('provider-portal', 'provider-portal--scroll');

      const oldToggle = document.querySelector('.mobile-menu-toggle, .biz-mobile-menu-toggle');
      if (oldToggle) oldToggle.remove();
      const oldOverlay = document.getElementById('sidebarOverlay');
      if (oldOverlay) oldOverlay.remove();

      const legacySidebar = document.getElementById('sidebar') || document.querySelector('.sidebar');
      if (legacySidebar) legacySidebar.remove();

      let mainEl =
        document.querySelector('.main-content') ||
        document.querySelector('main:not(.pp-content)') ||
        document.getElementById('ppMainContent');

      const layout = document.querySelector('.layout');
      const app = document.createElement('div');
      app.className = 'pp-app';
      app.innerHTML = SIDEBAR_HTML;

      const ppMain = document.createElement('div');
      ppMain.className = 'pp-main';

      const topbar = document.createElement('header');
      topbar.className = 'pp-topbar';
      topbar.innerHTML = `
        <div>
          <div class="pp-page-eyebrow" id="ppPageEyebrow"></div>
          <div class="pp-page-title" id="ppPageTitle"></div>
        </div>
        <div class="pp-topbar-right">
          <div class="pp-date-chip" id="ppDateChip"></div>
        </div>`;
      ppMain.appendChild(topbar);

      if (!document.getElementById('ppMobileToggle')) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'pp-mobile-toggle';
        toggle.id = 'ppMobileToggle';
        toggle.setAttribute('aria-label', 'Open menu');
        toggle.textContent = '☰';
        document.body.insertBefore(toggle, document.body.firstChild);
      }

      if (mainEl) {
        mainEl.classList.add('pp-content');
        if (mainEl.id !== 'ppMainContent') mainEl.id = 'ppMainContent';
        ppMain.appendChild(mainEl);
      } else {
        const content = document.createElement('main');
        content.className = 'pp-content';
        content.id = 'ppMainContent';
        ppMain.appendChild(content);
      }

      app.appendChild(ppMain);

      if (layout) {
        layout.replaceWith(app);
      } else {
        document.body.appendChild(app);
      }
    }

    const activeId = options.activeId || resolveActiveIdFromUrl();
    const initOpts = {
      activeId,
      eyebrow: options.eyebrow,
      title: options.title,
      useGreeting: options.useGreeting === true
    };

    if (typeof window.initProviderShell === 'function') {
      window.initProviderShell(initOpts);
    }

    // #region agent log
    fetch('http://127.0.0.1:7543/ingest/a415f78f-06bc-471d-9251-324ff2e64d53',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'4ae50e'},body:JSON.stringify({sessionId:'4ae50e',runId:'ui-audit-pre',hypothesisId:'H1',location:'provider-layout.js:142',message:'mountProviderPage_exit',data:{path:window.location.pathname,activeIdResolved:activeId,hasSidebarNav:!!document.getElementById('ppSidebarNav'),bodyHasProviderClass:document.body.classList.contains('provider-portal'),legacySidebarStillExists:!!(document.getElementById('sidebar')||document.querySelector('.sidebar'))},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    if (options.topbarActions) {
      const right = document.querySelector('.pp-topbar-right');
      if (right) right.insertAdjacentHTML('beforeend', options.topbarActions);
    }
  }

  window.mountProviderPage = mountProviderPage;
  window.resolveProviderActiveId = resolveActiveIdFromUrl;
})();
