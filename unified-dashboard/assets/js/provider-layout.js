/**
 * Mounts the shared FrontDesk provider shell on legacy business pages.
 * Call mountProviderPage({ activeId, eyebrow, title }) on DOMContentLoaded.
 */
(function () {
  const SIDEBAR_HTML = `
    <aside class="pp-sidebar" id="ppSidebar">
      <div class="pp-sb-logo">
        <div class="pp-sb-logo-inner">
          <div class="pp-sb-logo-mark" aria-hidden="true">⚕</div>
          <div>
            <div class="pp-sb-logo-text">FrontDesk</div>
            <div class="pp-sb-logo-sub" id="ppLogoSub">powered by Kelly</div>
          </div>
        </div>
      </div>
      <a class="pp-kelly-live" id="ppKellyLive" href="agent.html">
        <div class="pp-kelly-dot"></div>
        <div>
          <div class="pp-kelly-label" id="ppKellyLabel">Kelly is live</div>
          <div class="pp-kelly-sub" id="ppKellySub">Voice · scheduling · RCM</div>
        </div>
      </a>
      <nav class="pp-sb-nav" id="ppSidebarNav" aria-label="Main"></nav>
      <div class="pp-sb-footer">
        <a class="pp-sb-clinic" id="ppClinicCard" href="settings.html">
          <div class="pp-sb-av" id="ppClinicAv">CL</div>
          <div>
            <div class="pp-sb-cn" id="ppClinicName">Clinic</div>
            <div class="pp-sb-cr" id="ppClinicRole">Provider portal</div>
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
    if (file === 'billing.html') {
      if (section === 'invoices') return 'billing';
      if (section === 'prior-auth') return 'prior-auth';
      if (section === 'claims') return 'prior-auth';
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

    if (options.topbarActions) {
      const right = document.querySelector('.pp-topbar-right');
      if (right) right.insertAdjacentHTML('beforeend', options.topbarActions);
    }
  }

  window.mountProviderPage = mountProviderPage;
  window.resolveProviderActiveId = resolveActiveIdFromUrl;
})();
