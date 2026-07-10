/**
 * Shared sidebar chrome: Somo gecko icon + Kelly live widget.
 * Loaded after provider-shell.js; used by provider-layout and built-in shell pages.
 */
(function () {
  function resolveHref(href) {
    if (typeof window.resolveBusinessPath === 'function') {
      return window.resolveBusinessPath(href);
    }
    return href;
  }

  window.ppKellyWidgetHtml = function ppKellyWidgetHtml() {
    const agentHref = resolveHref('agent.html');
    return `
      <div class="pp-kelly-live kelly-provisioning" id="ppKellyLive">
        <a class="pp-kelly-live-link" href="${agentHref}" aria-label="Open Kelly control center">
          <span class="pp-kelly-dot" aria-hidden="true"></span>
          <div>
            <div class="pp-kelly-label" id="ppKellyLabel">Somo front desk</div>
            <div id="ppKellyNameplate" style="margin:4px 0"></div>
            <div class="pp-kelly-sub" id="ppKellySub">Loading status…</div>
            <div class="pp-kelly-phone" id="ppKellyPhone"></div>
          </div>
        </a>
        <button type="button" class="pp-kelly-toggle" id="ppKellyToggle">Activate</button>
      </div>`;
  };

  window.ppSidebarHeaderHtml = function ppSidebarHeaderHtml() {
    const todayHref = resolveHref('today.html');
    const logoSrc = '/assets/brand/somo-icon.png';
    return `
      <div class="pp-clinic-header">
        <a class="pp-sb-brand pp-sb-brand--icon" href="${todayHref}">
          <img src="${logoSrc}" alt="Somo" class="pp-sb-logo-img" width="36" height="36" />
        </a>
        <div class="pp-sb-clinic-meta">
          <div class="pp-sb-cn" id="ppClinicName">Clinic</div>
          <div class="pp-sb-cr" id="ppClinicRole">Provider</div>
          <div class="pp-sb-av pp-sb-av--sm" id="ppClinicAv" aria-hidden="true">CL</div>
        </div>
      </div>`;
  };

  window.ensureProviderSidebarChrome = function ensureProviderSidebarChrome() {
    const sidebar = document.getElementById('ppSidebar');
    if (!sidebar) return;

    const header = sidebar.querySelector('.pp-clinic-header');
    if (header && !header.querySelector('.pp-sb-brand')) {
      header.outerHTML = window.ppSidebarHeaderHtml();
    }

    if (!document.getElementById('ppKellyLive')) {
      const nav = document.getElementById('ppSidebarNav');
      const wrap = document.createElement('div');
      wrap.innerHTML = window.ppKellyWidgetHtml();
      const kelly = wrap.firstElementChild;
      if (nav) sidebar.insertBefore(kelly, nav);
      else sidebar.appendChild(kelly);
    } else if (!document.getElementById('ppKellyNameplate')) {
      const label = document.getElementById('ppKellyLabel');
      if (label && label.parentElement) {
        const np = document.createElement('div');
        np.id = 'ppKellyNameplate';
        np.style.margin = '4px 0';
        label.insertAdjacentElement('afterend', np);
      }
    }
  };
})();
