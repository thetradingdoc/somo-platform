/**
 * Mounts the shared Somo provider shell on legacy business pages.
 * Call mountProviderPage({ activeId, eyebrow, title }) on DOMContentLoaded.
 */
(function () {
  function sidebarHtml() {
    const header =
      typeof window.ppSidebarHeaderHtml === 'function'
        ? window.ppSidebarHeaderHtml()
        : `<div class="pp-clinic-header"><div class="pp-sb-av" id="ppClinicAv">CL</div><div><div class="pp-sb-cn" id="ppClinicName">Clinic</div><div class="pp-sb-cr" id="ppClinicRole">Provider</div></div></div>`;
    const kelly =
      typeof window.ppKellyWidgetHtml === 'function' ? window.ppKellyWidgetHtml() : '';
    return `
    <aside class="pp-sidebar" id="ppSidebar">
      ${header}
      ${kelly}
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
  }

  function resolveActiveIdFromUrl() {
    const file = (window.location.pathname.split('/').pop() || '').split('?')[0];
    const section = new URLSearchParams(window.location.search).get('section');
    if (file === 'today.html') return 'today';
    if (file === 'calendar.html' || file === 'video-call.html') return 'calendar';
    if (file === 'rcm-journey.html') return 'revenue';
    if (file === 'patients.html' || file === 'patient-case.html') return 'patients';
    if (file === 'revenue.html') return 'revenue';
    if (file === 'claims.html') return 'revenue';
    if (file === 'agent.html') return 'agent';
    if (file === 'settings.html') return 'profile';
    if (file === 'rcm.html') return 'revenue';
    if (file === 'patient-payments.html') return 'revenue';
    if (file === 'pdf-coding.html') return 'coding';
    if (file === 'billing.html') {
      if (section === 'invoices') return 'billing';
      if (section === 'prior-auth') return 'prior-auth';
      if (section === 'remittance') return 'remittance';
      if (section === 'overview' || section === 'scan') return 'claims';
      return 'claims';
    }
    if (file === 'invoices.html' || file === 'invoice-detail.html') return 'billing';
    if (file === 'payor-review.html') return 'payor-review';
    if (file === 'merge-review.html') return 'merge-review';
    if (file === 'feature-flags.html') return 'feature-flags';
    return 'today';
  }

  function mountTopVoiceNameplate(hostId) {
    const id = hostId || 'ppTopVoiceNameplate';
    const right = document.querySelector('.pp-topbar-right');
    if (!right || document.getElementById(id)) return;
    const np = document.createElement('div');
    np.id = id;
    np.style.marginRight = '8px';
    np.innerHTML = '<div class="sfd-skeleton" aria-hidden="true"><div class="sfd-skeleton-line sfd-skeleton-line--short"></div></div>';
    right.insertBefore(np, right.firstChild);
    if (window.VoiceAgentPage && window.SfdNameplate) {
      window.VoiceAgentPage.fetchVoiceAgentStatus()
        .then((status) => {
          if (!status) {
            np.innerHTML = '';
            return;
          }
          np.innerHTML = '';
          window.SfdNameplate.mountNameplate(np, status.nameplate || status.label || 'LIVE');
        })
        .catch(() => {
          np.innerHTML = '';
        });
    }
  }

  function mountProviderPage(options = {}) {
    const hasNav = document.getElementById('ppSidebarNav');
    if (!hasNav) {
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
      app.innerHTML = sidebarHtml();

      const ppMain = document.createElement('div');
      ppMain.className = 'pp-main';

      const topbar = document.createElement('header');
      topbar.className = 'pp-topbar pp-topbar--page';
      topbar.innerHTML = `
        <div class="pp-topbar-left">
          <p class="pp-page-eyebrow" id="ppPageEyebrow"></p>
          <h1 class="pp-page-title" id="ppPageTitle"></h1>
          <p class="pp-page-sub" id="ppPageSub" hidden></p>
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
    } else if (typeof window.ensureProviderSidebarChrome === 'function') {
      window.ensureProviderSidebarChrome();
    }

    const activeId = options.activeId || resolveActiveIdFromUrl();
    const initOpts = {
      activeId,
      eyebrow: options.eyebrow,
      title: options.title,
      subtitle: options.subtitle,
      useGreeting: options.useGreeting === true
    };

    if (typeof window.initProviderShell === 'function') {
      window.initProviderShell(initOpts);
    }

    if (options.backHref) {
      const left = document.querySelector('.pp-topbar-left');
      if (left && !left.querySelector('.pp-page-back')) {
        const href =
          typeof window.resolveBusinessPath === 'function'
            ? window.resolveBusinessPath(options.backHref)
            : options.backHref;
        const back = document.createElement('a');
        back.className = 'pp-page-back';
        back.href = href;
        const icon =
          typeof window.getNavIcon === 'function' ? window.getNavIcon('chevron-left') : '';
        back.innerHTML = `${icon ? `<span class="pp-page-back-icon" aria-hidden="true">${icon}</span>` : ''}${options.backLabel || 'Back'}`;
        left.insertBefore(back, left.firstChild);
      }
    }

    if (options.topbarActions) {
      const right = document.querySelector('.pp-topbar-right');
      if (right) right.insertAdjacentHTML('beforeend', options.topbarActions);
    }

    if (options.voiceNameplate) {
      mountTopVoiceNameplate(options.voiceNameplateHost || 'ppTopVoiceNameplate');
    }
  }

  window.mountProviderPage = mountProviderPage;
  window.mountTopVoiceNameplate = mountTopVoiceNameplate;
  window.resolveProviderActiveId = resolveActiveIdFromUrl;
})();
