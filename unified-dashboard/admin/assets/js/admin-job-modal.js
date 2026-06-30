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
        <h3 class="admin-crm-title" id="adminJobModalTitle">Running job...</h3>
        <div class="admin-crm-progress-log" id="adminJobModalLog"></div>
        <div class="admin-crm-modal-summary" id="adminJobModalResult"></div>
        <div class="admin-crm-modal-foot">
          <button class="admin-crm-btn-outline" id="adminJobModalClose" disabled>Close</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#adminJobModalClose').onclick = () => {
      if (overlay._autoCloseTimer) {
        clearTimeout(overlay._autoCloseTimer);
        overlay._autoCloseTimer = null;
      }
      overlay.classList.remove('open');
      overlay._onClose?.();
    };
    return overlay;
  }

  function finishJob(overlay, { url, result, onComplete, closeBtn, success }) {
    if (overlay._jobFinished) return;
    overlay._jobFinished = true;

    if (success) {
      onComplete?.();
      window.dispatchEvent(new CustomEvent('admin:job-complete', {
        detail: { url, result },
      }));
    }

    closeBtn.disabled = false;
    closeBtn.textContent = 'Close';

    if (success) {
      overlay._autoCloseTimer = setTimeout(() => {
        if (overlay.classList.contains('open')) {
          overlay.classList.remove('open');
          overlay._onClose?.();
        }
      }, 2500);
    }
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
    overlay._jobFinished = false;
    if (overlay._autoCloseTimer) {
      clearTimeout(overlay._autoCloseTimer);
      overlay._autoCloseTimer = null;
    }

    const log = overlay.querySelector('#adminJobModalLog');
    const resultEl = overlay.querySelector('#adminJobModalResult');
    const closeBtn = overlay.querySelector('#adminJobModalClose');
    const titleEl = overlay.querySelector('#adminJobModalTitle');

    titleEl.textContent = title;
    log.innerHTML = '';
    resultEl.textContent = '';
    closeBtn.disabled = true;
    closeBtn.textContent = 'Close';
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
      if (resp.status === 429) {
        const msg = AdminShell.rateLimitMessage
          ? AdminShell.rateLimitMessage(resp)
          : 'Rate limited — wait a moment and retry';
        addLine(`Rate limit (429): ${msg}`);
        titleEl.textContent = 'Rate limited';
        AdminShell.showToast(msg, 'warning', 8000);
        closeBtn.disabled = false;
        return;
      }
      if (!resp.ok) {
        let msg = `${resp.status} ${resp.statusText}`;
        try {
          const j = await resp.json();
          msg = j.error || j.message || msg;
        } catch { /* ignore */ }
        addLine(`Error: ${msg}`);
        titleEl.textContent = 'Error';
        AdminShell.showToast(msg, 'error');
        closeBtn.disabled = false;
        return;
      }
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
          if (r.gcs_persisted === true) parts.push('saved to cloud');
          else if (r.gcs_persisted === false) parts.push('cloud save pending');
          resultEl.textContent = parts.join(' · ') || 'Done';
          finishJob(overlay, { url, result: r, onComplete, closeBtn, success: true });
        }
        if (evt.type === 'error') {
          titleEl.textContent = 'Error';
          finishJob(overlay, { url, result: evt, onComplete, closeBtn, success: false });
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
