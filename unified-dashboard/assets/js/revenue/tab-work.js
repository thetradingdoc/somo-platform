/**
 * Revenue hub — Work queue tab (prior auth + exceptions)
 */
(function () {
  const UI = () => window.RevenueUI;
  const clinicId = () => (window.ppGetClinicId ? window.ppGetClinicId() : 'clinic-default');

  async function mountWorkTab(root) {
    if (!root) return;
    root.innerHTML = '<div class="pp-empty">Loading work queue…</div>';
    const ui = UI();
    try {
      const headers = window.ppGetAuthHeaders?.() || {};
      const paUrl = new URL(`${window.API_BASE || ''}/api/prior-auth/requests`);
      paUrl.searchParams.set('clinic_id', clinicId());
      paUrl.searchParams.set('status', 'pending');
      const exUrl = new URL(`${window.API_BASE || ''}/api/rcm/exceptions`);
      exUrl.searchParams.set('clinic_id', clinicId());
      const [paRes, exRes] = await Promise.all([
        fetch(paUrl.toString(), { credentials: 'include', headers }),
        fetch(exUrl.toString(), { credentials: 'include', headers }),
      ]);
      const paData = await paRes.json();
      const exData = await exRes.json();
      const paList = paData.requests || paData.items || [];
      const exceptions = exData.items || [];

      let html = ui.renderSectionLabel('Prior auth queue');
      if (!paList.length) {
        html += ui.renderEmptyState(
          'document-text',
          'No prior auth cases yet — Kelly flags PA-required services automatically.'
        );
      } else {
        const rows = paList.map((r) => [
          ui.escapeHtml(r.patient_name || r.patient_id || r.id),
          ui.renderStatusPill('pending'),
          ui.btnOutline('Review', ` data-pa-id="${ui.escapeHtml(r.id)}"`),
        ]);
        html += ui.renderTable({
          colsClass: 'pp-table-cols-work',
          columns: ['Patient', 'Status', 'Action'],
          rows,
        });
      }

      html += `<div style="margin-top:20px">${ui.renderSectionLabel('Exception inbox')}</div>`;
      if (!exceptions.length) {
        html += ui.renderEmptyState('exclamation-triangle', 'No AI exceptions requiring review.');
      } else {
        const rows = exceptions.map((item) => {
          const type = String(item.type || item.agent_type || 'issue').toLowerCase();
          const pillType = type.includes('denial') ? 'denied' : type.includes('cdi') ? 'open' : 'open';
          const label = type.includes('denial') ? 'denial' : type.includes('cdi') ? 'CDI' : type;
          return [
            ui.escapeHtml(item.title || item.summary || item.patient_name || item.decision_id || 'Issue'),
            `<span class="pp-status-pill pp-status-pill--${pillType === 'denied' ? 'denied' : 'open'}">${ui.escapeHtml(label)}</span>`,
            ui.btnOutline('Review', ` data-decision-id="${ui.escapeHtml(item.decision_id || item.id)}"`),
          ];
        });
        html += ui.renderTable({
          colsClass: 'pp-table-cols-work',
          columns: ['Issue', 'Type', 'Action'],
          rows,
        });
      }

      root.innerHTML = html;

      root.querySelectorAll('[data-decision-id]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const decisionId = btn.getAttribute('data-decision-id');
          if (!decisionId) return;
          if (!confirm('Apply drafted fix and attempt resubmission?')) return;
          btn.disabled = true;
          try {
            const res = await fetch(`${window.API_BASE || ''}/api/rcm/drafted-fix/apply`, {
              method: 'POST',
              credentials: 'include',
              headers: window.ppGetAuthHeaders?.() || { 'Content-Type': 'application/json' },
              body: JSON.stringify({ decision_id: decisionId, resubmit: true }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Fix failed');
            window.ppToast?.('Draft fix applied', 'success');
            await mountWorkTab(root);
          } catch (e) {
            window.ppToast?.(e.message || 'Fix failed', 'error');
          } finally {
            btn.disabled = false;
          }
        });
      });

      root.querySelectorAll('[data-pa-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          window.ppToast?.('Open prior auth detail from patient case', 'info');
        });
      });
    } catch (e) {
      root.innerHTML = `<div class="pp-empty">Error: ${ui.escapeHtml(e.message)}</div>`;
    }
  }

  window.mountWorkTab = mountWorkTab;
})();
