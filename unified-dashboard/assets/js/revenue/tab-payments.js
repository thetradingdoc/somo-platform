/**
 * Revenue hub — Patient pay tab
 */
(function () {
  const UI = () => window.RevenueUI;
  const clinicId = () => (window.ppGetClinicId ? window.ppGetClinicId() : 'clinic-default');
  let allPayments = [];
  let voiceCheckouts = [];
  let collectionQueue = [];
  let statusFilter = '';
  let selectedBalance = null;

  function statusPill(status) {
    const st = String(status || 'requested').toLowerCase();
    const cls = st === 'paid' ? 'paid' : 'open';
    return `<span class="pp-status-pill pp-status-pill--${cls}">${UI().escapeHtml(st)}</span>`;
  }

  function updateSendButtonState(root) {
    const btn = root.querySelector('#revPaySendBtn');
    const hint = root.querySelector('#revPaySendHint');
    if (!btn) return;
    const patientId = root.querySelector('#revPayPatientId')?.value?.trim();
    const amount = Number(root.querySelector('#revPayAmount')?.value);
    const ready = !!(patientId && amount > 0);
    btn.disabled = !ready;
    if (hint) {
      hint.textContent = ready
        ? 'Ready to send via Kelly.'
        : 'Select an open balance row below or enter Patient ID and amount.';
    }
  }

  function selectBalanceRow(root, item, rowEl) {
    selectedBalance = item;
    root.querySelectorAll('[data-balance-row]').forEach((el) => {
      el.classList.toggle('pp-table-row--selected', el === rowEl);
    });
    const pidInput = root.querySelector('#revPayPatientId');
    const amtInput = root.querySelector('#revPayAmount');
    if (pidInput) pidInput.value = item.patient_id || '';
    if (amtInput) amtInput.value = Number(item.amount_due || 0).toFixed(2);
    updateSendButtonState(root);
  }

  function renderBalanceQueue(root) {
    const ui = UI();
    const listEl = root.querySelector('#revPayBalanceList');
    if (!listEl) return;
    if (!collectionQueue.length) {
      listEl.innerHTML = ui.renderEmptyState(
        'credit-card',
        'No open balances in collection. Enter Patient ID and amount above to request payment.'
      );
      return;
    }
    const head = `<div class="pp-table-header pp-table-cols-pipeline"><span>Patient</span><span>Stage</span><span>Balance</span><span></span></div>`;
    const body = collectionQueue.slice(0, 30).map((j, idx) => {
      const name = j.patient_name || j.patient_id || 'Patient';
      const amount = `$${Number(j.amount_due || 0).toFixed(2)}`;
      const stage = j.stage_label || j.stage || 'Collection';
      const selected =
        selectedBalance &&
        selectedBalance.patient_id === j.patient_id &&
        Number(selectedBalance.amount_due || 0) === Number(j.amount_due || 0);
      return `<div class="pp-table-row pp-table-cols-pipeline${selected ? ' pp-table-row--selected' : ''}" data-balance-row data-balance-idx="${idx}" role="button" tabindex="0">
        <span style="font-weight:600">${ui.escapeHtml(name)}</span>
        ${ui.renderStatusPill(stage)}
        <span class="pp-table-amount">${amount}</span>
        <span class="pp-muted" style="font-size:12px">Click to select</span>
      </div>`;
    }).join('');
    listEl.innerHTML = `<div class="pp-table-wrap">${head}${body}</div>`;
    listEl.querySelectorAll('[data-balance-row]').forEach((rowEl) => {
      const idx = Number(rowEl.getAttribute('data-balance-idx'));
      const item = collectionQueue[idx];
      if (!item) return;
      const activate = () => selectBalanceRow(root, item, rowEl);
      rowEl.addEventListener('click', activate);
      rowEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          activate();
        }
      });
    });
  }

  function renderVoiceCheckoutsTable(root) {
    const ui = UI();
    const listEl = root.querySelector('#revVoiceCheckoutList');
    if (!listEl) return;
    if (!voiceCheckouts.length) {
      listEl.innerHTML = ui.renderEmptyState(
        'credit-card',
        'No Kelly voice checkouts yet for this clinic.'
      );
      return;
    }
    const tableRows = voiceCheckouts.slice(0, 40).map((c) => {
      const who = c.customer_email || c.customer_phone || c.appointment_id || 'Checkout';
      const when = c.created_at ? new Date(c.created_at).toLocaleString() : '—';
      return [
        `<span style="font-weight:600">${ui.escapeHtml(who)}</span>`,
        `<span class="pp-table-amount">$${Number(c.amount || 0).toFixed(2)}</span>`,
        statusPill(c.status || 'pending'),
        `<span class="pp-muted" style="font-size:12px">${ui.escapeHtml(when)}</span>`,
      ];
    });
    listEl.innerHTML = ui.renderTable({
      colsClass: 'pp-table-cols-claims',
      columns: ['Patient / checkout', 'Amount', 'Status', 'Created'],
      rows: tableRows,
    });
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
      const cqUrl = new URL(`${window.API_BASE || ''}/api/rcm/collection-queue`);
      cqUrl.searchParams.set('clinic_id', clinicId());
      const vcUrl = new URL(`${window.API_BASE || ''}/api/rcm/voice-checkouts`);
      vcUrl.searchParams.set('clinic_id', clinicId());
      const [sumRes, listRes, cqRes, vcRes] = await Promise.all([
        fetch(summaryUrl.toString(), { credentials: 'include', headers }),
        fetch(listUrl.toString(), { credentials: 'include', headers }),
        fetch(cqUrl.toString(), { credentials: 'include', headers }),
        fetch(vcUrl.toString(), { credentials: 'include', headers }),
      ]);
      const sumData = await sumRes.json();
      const listData = await listRes.json();
      const cqData = await cqRes.json().catch(() => ({}));
      const vcData = await vcRes.json().catch(() => ({}));
      allPayments = listData.payments || [];
      voiceCheckouts = vcData.checkouts || [];
      collectionQueue = cqData.collection_queue || [];
      selectedBalance = null;
      const ui = UI();
      const s = sumData.summary || sumData || {};
      const recent = Number(s.total || s.recent || allPayments.length);
      const paid = allPayments.filter((p) => String(p.status).toLowerCase() === 'paid').length;
      const pending = allPayments.filter((p) =>
        ['requested', 'sent', 'pending'].includes(String(p.status).toLowerCase())
      ).length;
      const voicePaid = voiceCheckouts.filter((c) => String(c.status).toLowerCase() === 'completed').length;

      root.innerHTML = `
        ${ui.renderKpiRow(
          [
            { label: 'RCM requests', value: String(recent) },
            { label: 'Voice checkouts', value: String(voiceCheckouts.length) },
            { label: 'Paid (RCM)', value: String(paid), tone: 'success' },
            { label: 'Voice paid', value: String(voicePaid), tone: 'success' },
          ],
          4
        )}
        <div class="pp-revenue-composer">
          <span class="pp-revenue-composer-label">Request payment from patient</span>
          <input class="pp-input" id="revPayPatientId" placeholder="Patient ID" style="width:140px;height:36px" />
          <input class="pp-input" id="revPayAmount" placeholder="$0.00" type="number" min="0.01" step="0.01" style="width:90px;height:36px;font-family:var(--mono)" />
          <button type="button" class="pp-btn pp-btn-primary" id="revPaySendBtn" disabled>
            <span class="pp-inline-icon" aria-hidden="true">${ui.iconHtml('paper-airplane')}</span>
            Send via Kelly
          </button>
        </div>
        <p id="revPaySendHint" class="pp-muted" style="font-size:13px;margin:-4px 0 16px">Select an open balance row below or enter Patient ID and amount.</p>
        ${ui.renderSectionLabel('Open balances')}
        <div id="revPayBalanceList"></div>
        ${ui.renderSectionLabel('Kelly voice checkouts')}
        <div id="revVoiceCheckoutList"></div>
        ${ui.renderSectionLabel('RCM payment requests')}
        <div class="pp-panel-tabs" id="revPayFilters" style="margin-bottom:12px;border-bottom:1px solid var(--border)">
          <button type="button" class="pp-ptab act" data-status="">All</button>
          <button type="button" class="pp-ptab" data-status="requested">Requested</button>
          <button type="button" class="pp-ptab" data-status="paid">Paid</button>
        </div>
        <div id="revPayList"></div>`;

      root.querySelector('#revPayPatientId')?.addEventListener('input', () => updateSendButtonState(root));
      root.querySelector('#revPayAmount')?.addEventListener('input', () => updateSendButtonState(root));

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
          const body = { patient_id: patientId, amount };
          if (selectedBalance?.id) body.journey_id = selectedBalance.id;
          const res = await fetch(
            `${window.API_BASE || ''}/api/rcm/payments/request?clinic_id=${encodeURIComponent(clinicId())}`,
            {
              method: 'POST',
              credentials: 'include',
              headers: window.ppGetAuthHeaders?.() || { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }
          );
          const data = await res.json();
          if (!data.success) throw new Error(data.error || 'Request failed');
          window.ppToast?.('Payment link sent', 'success');
          await mountPaymentsTab(root);
        } catch (e) {
          window.ppToast?.(e.message || 'Request failed', 'error');
        } finally {
          updateSendButtonState(root);
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

      renderBalanceQueue(root);
      renderVoiceCheckoutsTable(root);
      renderPaymentsTable(root);
      updateSendButtonState(root);
    } catch (e) {
      root.innerHTML = `<div class="pp-empty">Error: ${UI().escapeHtml(e.message)}</div>`;
    }
  }

  window.mountPaymentsTab = mountPaymentsTab;
})();
