/**
 * SFD nameplate renderer — maps API labels to sfd-nameplate CSS (FD-219, FD-304).
 */
(function (global) {
  const MODIFIER = {
    LIVE: 'live',
    PAUSED: 'paused',
    OFF: 'off',
    CLOSED: 'closed',
    'COVERAGE-OFF': 'coverage-off',
    SHADOW: 'shadow',
    'MANUAL SYNC': 'manual-sync',
    CONNECTED: 'connected',
    'NOT YET AVAILABLE': 'unavailable',
    'PENDING INVITE': 'pending-invite',
    'NEEDS REAUTH': 'reauth',
    'ACTION NEEDED': 'action-needed',
    ERROR: 'error',
    DISCONNECTED: 'off',
    VERIFIED: 'connected',
    'LINK SENT': 'pending',
    'SYNC PENDING': 'manual-sync'
  };

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function nameplateClassForStatus(label, opts = {}) {
    const raw = String(label || '').trim().toUpperCase();
    const mod = MODIFIER[raw] || String(label || 'off').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const sm = opts.sm ? ' sfd-nameplate--sm' : '';
    return `sfd-nameplate sfd-nameplate--${mod}${sm}`;
  }

  function renderNameplate(label, opts = {}) {
    const text = String(label || '—').trim();
    const cls = nameplateClassForStatus(text, opts);
    const aria = opts.ariaLabel || text;
    return `<span class="${cls}" role="status" aria-label="${escapeHtml(aria)}"><span class="sfd-nameplate__led" aria-hidden="true"></span>${escapeHtml(text)}</span>`;
  }

  function mountNameplate(container, label, opts = {}) {
    if (!container) return;
    container.innerHTML = renderNameplate(label, opts);
  }

  function renderChip(label, opts = {}) {
    return renderNameplate(label, { ...opts, sm: true });
  }

  global.SfdNameplate = {
    MODIFIER,
    nameplateClassForStatus,
    renderNameplate,
    mountNameplate,
    renderChip
  };
})(typeof window !== 'undefined' ? window : global);
