/**
 * Revenue hub — Claims tab (claims + remittance + create claim panel)
 */
(function () {
  const UI = () => window.RevenueUI;
  const clinicId = () => (window.ppGetClinicId ? window.ppGetClinicId() : 'clinic-default');

  async function mountClaimsTab(root) {
    if (!root) return;
    root.innerHTML = '<div class="pp-empty">Loading claims…</div>';
    const ui = UI();
    try {
      const headers = window.ppGetAuthHeaders?.() || {};
      const eobUrl = new URL(`${window.API_BASE || ''}/api/admin/billing/eob`);
      eobUrl.searchParams.set('clinic_id', clinicId());
      const remUrl = new URL(`${window.API_BASE || ''}/api/rcm/remittances`);
      remUrl.searchParams.set('clinic_id', clinicId());
      const [eobRes, remRes] = await Promise.all([
        fetch(eobUrl.toString(), { credentials: 'include', headers }),
        fetch(remUrl.toString(), { credentials: 'include', headers }),
      ]);
      const eob = await eobRes.json();
      const rem = await remRes.json();
      if (!eob.success) throw new Error(eob.error || 'Failed to load claims');
      const summary = eob.summary || {};
      const patients = eob.patients || [];
      const remittances = rem.remittances || rem.items || [];

      let html = ui.renderKpiRow(
        [
          { label: 'Total billed', value: `$${Number(summary.total_billed || 0).toFixed(0)}` },
          { label: 'Plan paid', value: `$${Number(summary.total_paid || 0).toFixed(0)}`, tone: 'success' },
          { label: 'You owe', value: `$${Number(summary.total_owed || 0).toFixed(0)}`, tone: 'warn' },
        ],
        3
      );

      html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        ${ui.renderSectionLabel('Claims & EOB').replace('margin-bottom:0', 'margin-bottom:0')}
        <button type="button" class="pp-btn pp-btn-primary pp-btn-sm" id="revCreateClaimBtn">
          <span class="pp-inline-icon" aria-hidden="true">${ui.iconHtml('plus')}</span>
          Create claim
        </button>
      </div>`;

      if (!patients.length) {
        html += ui.renderEmptyState(
          'clipboard-document-list',
          'No claims found. Scan a PDF to create your first claim.'
        );
      } else {
        const rows = patients.map((p) => [
          `<span style="font-weight:600">${ui.escapeHtml(p.patient_name || 'Unknown')}</span>`,
          ui.escapeHtml(p.payer || '—'),
          `<span class="pp-table-amount">$${Number(p.total_billed || 0).toFixed(2)}</span>`,
          `<button type="button" class="pp-btn pp-btn-outline pp-btn-sm" data-eob-patient="${ui.escapeHtml(p.patient_id)}">View</button>`,
        ]);
        html += ui.renderTable({
          colsClass: 'pp-table-cols-claims',
          columns: ['Patient', 'Payer', 'Billed', 'EOB'],
          rows,
        });
      }

      html += `<div id="remittance" style="margin-top:20px">${ui.renderSectionLabel('Remittance (ERA)')}</div>`;
      if (!remittances.length) {
        html += ui.renderEmptyState('banknotes', 'No remittance postings yet.');
      } else {
        const remRows = remittances.slice(0, 20).map((r) => [
          ui.escapeHtml(r.posted_at || r.created_at || '—'),
          ui.escapeHtml(r.payer_name || r.payer || 'Unknown payer'),
          `<span class="pp-table-amount">$${Number(r.amount || 0).toFixed(2)}</span>`,
        ]);
        html += ui.renderTable({
          colsClass: 'pp-table-cols-remit',
          columns: ['Posted', 'Payer', 'Amount'],
          rows: remRows,
        });
      }

      html += `<div id="revCreatePanel" hidden style="margin-top:16px;padding:16px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--surface)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <strong style="font-size:14px">Upload superbill</strong>
          <button type="button" class="pp-btn pp-btn-ghost pp-btn-sm" id="revCreateClose">Close</button>
        </div>
        <p style="font-size:13px;color:var(--muted);margin-bottom:12px">Drop a PDF or open the full coding workspace.</p>
        <a class="pp-btn pp-btn-primary pp-btn-sm" href="billing.html?section=scan&legacy_tabs=1">Open scan workspace</a>
      </div>`;

      root.innerHTML = html;

      root.querySelector('#revCreateClaimBtn')?.addEventListener('click', () => {
        const panel = root.querySelector('#revCreatePanel');
        if (panel) panel.hidden = false;
      });
      root.querySelector('#revCreateClose')?.addEventListener('click', () => {
        const panel = root.querySelector('#revCreatePanel');
        if (panel) panel.hidden = true;
      });

      if (new URLSearchParams(window.location.search).get('panel') === 'create') {
        root.querySelector('#revCreatePanel')?.removeAttribute('hidden');
      }

      root.querySelectorAll('[data-eob-patient]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const patientId = btn.getAttribute('data-eob-patient');
          window.location.href = `patient-case.html?patient_id=${encodeURIComponent(patientId)}`;
        });
      });
    } catch (e) {
      root.innerHTML = `<div class="pp-empty">Error: ${ui.escapeHtml(e.message)}</div>`;
    }
  }

  window.mountClaimsTab = mountClaimsTab;
})();
