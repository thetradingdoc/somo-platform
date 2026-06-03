/**
 * Revenue hub — Patient pay tab
 */
(function () {
  const UI = () => window.RevenueUI;
  const clinicId = () => (window.ppGetClinicId ? window.ppGetClinicId() : 'clinic-default');
  let allPayments = [];
  let statusFilter = '';

  function statusPill(status) {
    const st = String(status || 'requested').toLowerCase();
    const cls = st === 'paid' ? 'paid' : 'open';
    return `<span class="pp-status-pill pp-status-pill--${cls}">${UI().escapeHtml(st)}</span>`;
  }

  function renderPaymentsTable(root) {
    const ui = UI();
    const rows = allPayments.filter(
      (p) => !statusFilter || String(p.status || '').toLowerCase() === statusFilter
    );
    const listEl = root.querySelector('#revPayList');
    if (!listEl) return;
    if (!rows.length) {
      listEl.innerHTML = ui.renderEmptyState(
        'credit-card',
        'No payment requests yet. Use the form above or ask Kelly on a call to send a pay link.'
      );
      return;
    }
    const tableRows = rows.slice(0, 50).map((p) => {
      const name = p.patient_name || p.patient_id || 'Patient';
      const pid = p.patient_id || '';
      const actions = [];
      if (pid) {
        actions.push(
          `<a class="pp-btn pp-btn-outline pp-btn-sm" href="patient-case.html?patient_id=${encodeURIComponent(pid)}">Open</a>`
        );
      }
      if (String(p.status || '').toLowerCase() === 'requested' && p.journey_id) {
        actions.push(
          ui.btnPrimary('Resend via Kelly', ` data-kelly-resend data-journey="${ui.escapeHtml(p.journey_id)}" data-patient="${ui.escapeHtml(pid)}" data-amount="${Number(p.amount || 0)}"`)
        );
      }
      return [
        `<span style="font-weight:600">${ui.escapeHtml(name)}</span>`,
        `<span class="pp-table-amount">$${Number(p.amount || 0).toFixed(2)}</span>`,
        statusPill(p.status),
        actions.join(' ') || '—',
      ];
    });
    listEl.innerHTML = ui.renderTable({
      colsClass: 'pp-table-cols-claims',
      columns: ['Patient', 'Amount', 'Status', 'Action'],
      rows: tableRows,
    });
    listEl.querySelectorAll('[data-kelly-resend]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await window.ppResendViaKelly({
            journeyId: btn.getAttribute('data-journey'),
            patientId: btn.getAttribute('data-patient'),
            amount: Number(btn.getAttribute('data-amount') || 0),
          });
          window.ppToast?.('Sent via Kelly', 'success');
          await mountPaymentsTab(root);
        } catch (e) {
          window.ppToast?.(e.message || 'Send failed', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });
  }

  async function mountPaymentsTab(root) {
    if (!root) return;
    root.innerHTML = '<div class="pp-empty">Loading payments…</div>';
    try {
      const headers = window.ppGetAuthHeaders?.() || {};
      const summaryUrl = new URL(`${window.API_BASE || ''}/api/rcm/payments/summary`);
      summaryUrl.searchParams.set('clinic_id', clinicId());
      const listUrl = new URL(`${window.API_BASE || ''}/api/rcm/payments`);
      listUrl.searchParams.set('clinic_id', clinicId());
      const [sumRes, listRes] = await Promise.all([
        fetch(summaryUrl.toString(), { credentials: 'include', headers }),
        fetch(listUrl.toString(), { credentials: 'include', headers }),
      ]);
      const sumData = await sumRes.json();
      const listData = await listRes.json();
      allPayments = listData.payments || [];
      const ui = UI();
      const s = sumData.summary || sumData || {};
      const recent = Number(s.total || s.recent || allPayments.length);
      const paid = allPayments.filter((p) => String(p.status).toLowerCase() === 'paid').length;
      const pending = allPayments.filter((p) =>
        ['requested', 'sent', 'pending'].includes(String(p.status).toLowerCase())
      ).length;

      root.innerHTML = `
        ${ui.renderKpiRow(
          [
            { label: 'Recent requests', value: String(recent) },
            { label: 'Paid', value: String(paid), tone: 'success' },
            { label: 'Pending', value: String(pending), tone: 'warn' },
          ],
          3
        )}
        <div class="pp-revenue-composer">
          <span class="pp-revenue-composer-label">Request payment from patient</span>
          <input class="pp-input" id="revPayPatientId" placeholder="Patient ID" style="width:140px;height:36px" />
          <input class="pp-input" id="revPayAmount" placeholder="$0.00" type="number" min="0.01" step="0.01" style="width:90px;height:36px;font-family:var(--mono)" />
          <button type="button" class="pp-btn pp-btn-primary" id="revPaySendBtn">
            <span class="pp-inline-icon" aria-hidden="true">${ui.iconHtml('paper-airplane')}</span>
            Send via Kelly
          </button>
        </div>
        ${ui.renderSectionLabel('Recent requests')}
        <div class="pp-panel-tabs" id="revPayFilters" style="margin-bottom:12px;border-bottom:1px solid var(--border)">
          <button type="button" class="pp-ptab act" data-status="">All</button>
          <button type="button" class="pp-ptab" data-status="requested">Requested</button>
          <button type="button" class="pp-ptab" data-status="paid">Paid</button>
        </div>
        <div id="revPayList"></div>`;

      root.querySelector('#revPaySendBtn')?.addEventListener('click', async () => {
        const patientId = root.querySelector('#revPayPatientId')?.value?.trim();
        const amount = Number(root.querySelector('#revPayAmount')?.value);
        if (!patientId || !(amount > 0)) {
          window.ppToast?.('Patient ID and amount required', 'error');
          return;
        }
        const btn = root.querySelector('#revPaySendBtn');
        btn.disabled = true;
        try {
          const res = await fetch(
            `${window.API_BASE || ''}/api/rcm/payments/request?clinic_id=${encodeURIComponent(clinicId())}`,
            {
              method: 'POST',
              credentials: 'include',
              headers: window.ppGetAuthHeaders?.() || { 'Content-Type': 'application/json' },
              body: JSON.stringify({ patient_id: patientId, amount }),
            }
          );
          const data = await res.json();
          if (!data.success) throw new Error(data.error || 'Request failed');
          window.ppToast?.('Payment link sent', 'success');
          await mountPaymentsTab(root);
        } catch (e) {
          window.ppToast?.(e.message || 'Request failed', 'error');
        } finally {
          btn.disabled = false;
        }
      });

      root.querySelector('#revPayFilters')?.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-status]');
        if (!btn) return;
        statusFilter = btn.getAttribute('data-status') || '';
        root.querySelectorAll('#revPayFilters .pp-ptab').forEach((t) => {
          t.classList.toggle('act', t === btn);
        });
        renderPaymentsTable(root);
      });

      renderPaymentsTable(root);
    } catch (e) {
      root.innerHTML = `<div class="pp-empty">Error: ${UI().escapeHtml(e.message)}</div>`;
    }
  }

  window.mountPaymentsTab = mountPaymentsTab;
})();
