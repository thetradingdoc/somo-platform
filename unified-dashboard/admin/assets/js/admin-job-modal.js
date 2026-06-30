/**
 * Shared SSE job modal for scrape / enrich on any admin page
 */
(function () {
  function ensureModal() {
    let overlay = document.getElementById('adminJobModal');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'adminJobModal';
    overlay.className = 'admin-crm-modal-overlay';
    overlay.innerHTML = `
      <div class="admin-crm-modal">
        <div class="admin-crm-title" id="adminJobModalTitle" style="margin-bottom:16px;font-size:16px;">Running job...</div>
        <div class="admin-crm-progress-log" id="adminJobModalLog"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div id="adminJobModalResult" style="font-size:13px;color:var(--muted);"></div>
          <button class="admin-crm-btn-outline" id="adminJobModalClose" disabled>Close</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#adminJobModalClose').onclick = () => {
      overlay.classList.remove('open');
      overlay._onClose?.();
    };
    return overlay;
  }

  async function openJobModal(options) {
    const {
      title = 'Running job...',
      url,
      method = 'POST',
      body = null,
      onComplete,
      onEvent,
    } = options;

    const overlay = ensureModal();
    const log = overlay.querySelector('#adminJobModalLog');
    const resultEl = overlay.querySelector('#adminJobModalResult');
    const closeBtn = overlay.querySelector('#adminJobModalClose');
    const titleEl = overlay.querySelector('#adminJobModalTitle');

    titleEl.textContent = title;
    log.innerHTML = '';
    resultEl.textContent = '';
    closeBtn.disabled = true;
    overlay.classList.add('open');
    overlay._onClose = onComplete;

    const addLine = (text) => {
      const d = document.createElement('div');
      d.textContent = text;
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
    };

    const API = window.API_BASE || '';
    try {
      const resp = await fetch(`${API}${url}`, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: body != null ? JSON.stringify(body) : undefined,
      });
      await AdminShell.consumeSse(resp, addLine, (evt) => {
        onEvent?.(evt, { addLine, resultEl, titleEl, closeBtn });
        if (evt.type === 'done') {
          titleEl.textContent = 'Complete';
          const r = evt.result || {};
          const parts = [];
          if (r.saved_callable != null) parts.push(`${r.saved_callable} callable`);
          if (r.saved_needs_phone != null) parts.push(`${r.saved_needs_phone} need phone`);
          if (r.saved != null && parts.length === 0) parts.push(`${r.saved} saved`);
          if (r.enriched != null) parts.push(`${r.enriched} enriched`);
          if (r.still_needs_phone != null) parts.push(`${r.still_needs_phone} still need phone`);
          resultEl.textContent = parts.join(' · ') || 'Done';
          closeBtn.disabled = false;
        }
        if (evt.type === 'error') {
          titleEl.textContent = 'Error';
          closeBtn.disabled = false;
        }
      });
    } catch (e) {
      addLine('Network error: ' + e.message);
      AdminShell.showToast(e.message, 'error');
      closeBtn.disabled = false;
    }
  }

  window.AdminJobModal = { open: openJobModal };
})();
