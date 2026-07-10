/**
 * Settings — Connected Accounts tab (FD-194–201, FD-222, FD-232).
 */
(function () {
  const SP = window.SettingsPage || {};
  const esc = window.SomoHtml?.escapeHtml || ((s) => String(s ?? ''));

  function np(label) {
    return window.SfdNameplate?.renderNameplate(label, { sm: false }) || label;
  }

  function ensureDisconnectModal() {
    if (document.getElementById('connectedDisconnectModal')) return;
    const modal = document.createElement('div');
    modal.id = 'connectedDisconnectModal';
    modal.className = 'sfd-modal-backdrop';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="sfd-modal" role="dialog" aria-labelledby="connectedDisconnectTitle">
        <div class="sfd-modal__body">
          <h3 id="connectedDisconnectTitle" style="margin:0 0 8px">Disconnect Google Calendar?</h3>
          <p class="sfd-muted" style="margin:0">Kelly will stop syncing appointments until you reconnect a calendar.</p>
        </div>
        <div class="sfd-modal__footer">
          <button type="button" class="sfd-btn sfd-btn-ghost" id="connectedDisconnectCancel">Cancel</button>
          <button type="button" class="sfd-btn sfd-btn-primary" id="connectedDisconnectConfirm">Disconnect</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.hidden = true;
    });
    modal.querySelector('#connectedDisconnectCancel')?.addEventListener('click', () => {
      modal.hidden = true;
    });
    modal.querySelector('#connectedDisconnectConfirm')?.addEventListener('click', async () => {
      modal.hidden = true;
      const email = SP.userData?.email || window.SettingsPage?.userData?.email;
      if (!email) return;
      try {
        const res = await fetch(`${SP.API_BASE || window.API_BASE}/api/calendar/disconnect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (data.success) loadConnectedAccounts();
      } catch (_) {}
    });
  }

  window.showConnectedDisconnectModal = function showConnectedDisconnectModal() {
    ensureDisconnectModal();
    const modal = document.getElementById('connectedDisconnectModal');
    if (modal) modal.hidden = false;
  };

  async function loadConnectedAccounts() {
    const mount = document.getElementById('connectedAccountsMount');
    if (!mount) return;
    const fetchStatus = async function fetchIntegrationsStatus() {
        const base = SP.API_BASE || window.API_BASE || window.location.origin;
        const res = await (window.ppFetch || fetch)(`${base}/api/tenant/integrations/status`, {
          credentials: 'include',
          headers:
            typeof window.ppGetAuthHeaders === 'function'
              ? window.ppGetAuthHeaders()
              : { 'Content-Type': 'application/json' }
        });
        if (!res.ok) throw new Error(`Integrations status unavailable (${res.status})`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Integrations status failed');
        return json;
      };
    mount.innerHTML = '<div class="sfd-skeleton"><div class="sfd-skeleton-line"></div></div>';
    try {
      const status = await fetchStatus();
      const g = status.google_calendar || {};
      const d = status.dentrix || {};
      const s = status.stripe || {};
      mount.innerHTML = `
        <div class="sfd-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
            <div><h3 style="margin:0">Google Calendar</h3><p class="sfd-muted">${esc(g.calendar_email || 'Not connected')}</p></div>
            ${np(g.nameplate || (g.connected ? 'CONNECTED' : 'DISCONNECTED'))}
          </div>
          <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
            <button type="button" class="sfd-btn sfd-btn-primary" onclick="connectGoogleCalendar()">${g.connected ? 'Change calendar' : 'Connect Google'}</button>
            ${g.connected ? '<button type="button" class="sfd-btn sfd-btn-ghost" onclick="showConnectedDisconnectModal()">Disconnect</button>' : ''}
          </div>
        </div>
        <div class="sfd-card sfd-card--paper">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
            <div><h3 style="margin:0">Dentrix / PMS</h3><p class="sfd-muted">Manual interim until API Exchange is approved.</p></div>
            ${np(d.nameplate || 'MANUAL SYNC')}
          </div>
          <div class="sfd-callout" style="margin-top:12px"><b>Manual Dentrix interim:</b> Kelly books to Somo and emails a daily digest for your front desk to enter in Dentrix.</div>
          <div id="pmsSyncErrorsList" class="sfd-muted" style="margin-top:8px;font-size:0.88rem"></div>
        </div>
        <div class="sfd-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
            <div><h3 style="margin:0">Stripe billing</h3><p class="sfd-muted">${esc(s.subscription_status || 'Subscription status')}</p></div>
            ${np(s.nameplate || 'ACTION NEEDED')}
          </div>
          <a href="revenue.html?tab=payments" class="sfd-btn sfd-btn-secondary" style="margin-top:12px;text-decoration:none">Manage billing</a>
        </div>
        <p class="sfd-muted" style="margin-top:12px"><a href="#advanced" onclick="setSettingsTab('advanced');return false">Advanced credentials &amp; API →</a></p>`;
      loadPmsSyncErrors();
    } catch (e) {
      mount.innerHTML = `<div class="sfd-callout">Could not load integrations: ${esc(e.message)}</div>`;
    }
  }

  async function loadPmsSyncErrors() {
    const el = document.getElementById('pmsSyncErrorsList');
    if (!el) return;
    try {
      const res = await fetch(`${SP.API_BASE || window.API_BASE}/api/tenant/pms/sync-errors`, {
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      const rows = data.errors || data.sync_errors || [];
      if (!rows.length) {
        el.textContent = 'No failed sync entries.';
        return;
      }
      el.innerHTML =
        '<b>Failed sync entries</b><ul style="margin:8px 0 0;padding-left:18px">' +
        rows
          .slice(0, 8)
          .map((r) => `<li>${esc(String(r.error_message || r.operation || 'Sync error').slice(0, 120))}</li>`)
          .join('') +
        '</ul>';
    } catch (_) {
      el.textContent = '';
    }
  }

  window.loadConnectedAccounts = loadConnectedAccounts;
})();
