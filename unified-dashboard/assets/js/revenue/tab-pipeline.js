/**
 * Revenue hub — Pipeline tab
 */
(function () {
  const UI = () => window.RevenueUI;
  const clinicId = () => (window.ppGetClinicId ? window.ppGetClinicId() : 'clinic-default');

  async function mountPipelineTab(root) {
    if (!root) return;
    root.innerHTML = '<div class="pp-empty">Loading pipeline…</div>';
    try {
      const headers = window.ppGetAuthHeaders?.() || {};
      const ccUrl = new URL(`${window.API_BASE || ''}/api/rcm/command-center`);
      ccUrl.searchParams.set('clinic_id', clinicId());
      const cqUrl = new URL(`${window.API_BASE || ''}/api/rcm/collection-queue`);
      cqUrl.searchParams.set('clinic_id', clinicId());
      const [ccRes, cqRes] = await Promise.all([
        fetch(ccUrl.toString(), { credentials: 'include', headers }),
        fetch(cqUrl.toString(), { credentials: 'include', headers }),
      ]);
      const cc = await ccRes.json();
      const cq = await cqRes.json();
      if (!cc.success) throw new Error(cc.error || 'Failed to load command center');
      const s = cc.summary || {};
      const stages = cc.stages || [];
      const queue = cq.collection_queue || [];
      const ui = UI();

      let html = ui.renderKpiRow(
        [
          { label: 'Open journeys', value: String(Number(s.journeys_open || 0)) },
          { label: 'In collection', value: String(Number(s.collection_open || 0)), tone: 'warn' },
          {
            label: 'Patient payments',
            value: `$${Number(s.patient_payments_total || 0).toFixed(0)}`,
            tone: 'success',
          },
          { label: 'Remittance', value: `$${Number(s.remittance_total || 0).toFixed(0)}` },
        ],
        4
      );

      html += ui.renderSectionLabel('Journey stages');
      html += '<div class="journey-strip" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px">';
      if (!stages.length) {
        html += '<span style="color:var(--muted);font-size:13px">No RCM journeys yet.</span>';
      } else {
        stages.forEach((row) => {
          html += ui.renderJourneyChip(
            row.stage || row.stage_id,
            row.count,
            row.stage_label
          );
        });
      }
      html += '</div>';

      html += ui.renderSectionLabel('Collection queue');
      if (!queue.length) {
        html += ui.renderEmptyState('credit-card', 'No journeys in collection or billing.');
      } else {
        const rows = queue.map((j) => {
          const name = j.patient_name || j.patient_id || 'Patient';
          const stageLabel = j.stage_label || j.stage || 'Collection';
          const amount = `$${Number(j.amount_due || 0).toFixed(2)}`;
          const resend =
            j.resend_eligible && j.id
              ? ui.btnPrimary('Resend via Kelly', ` data-kelly-resend data-journey="${ui.escapeHtml(j.id)}" data-patient="${ui.escapeHtml(j.patient_id || '')}" data-amount="${Number(j.amount_due || 0)}"`)
              : j.patient_id
                ? `<a class="pp-btn pp-btn-outline pp-btn-sm" href="patient-case.html?patient_id=${encodeURIComponent(j.patient_id)}">View</a>`
                : '—';
          const actions = ui.renderTableActions([
            resend,
            j.id
              ? `<a class="pp-btn pp-btn-ghost pp-btn-sm" href="rcm-journey.html?journey_id=${encodeURIComponent(j.id)}&from=pipeline">Journey</a>`
              : '',
            j.patient_id
              ? `<a class="pp-btn pp-btn-ghost pp-btn-sm" href="patient-case.html?patient_id=${encodeURIComponent(j.patient_id)}">Case</a>`
              : '',
          ]);
          return [
            `<span style="font-weight:600">${ui.escapeHtml(name)}</span>`,
            ui.renderStatusPill(stageLabel),
            `<span class="pp-table-amount">${amount}</span>`,
            actions,
          ];
        });
        html += ui.renderTable({
          colsClass: 'pp-table-cols-pipeline',
          columns: ['Patient', 'Stage', 'Amount', 'Action'],
          rows,
        });
      }

      root.innerHTML = html;
      root.querySelectorAll('[data-kelly-resend]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          try {
            await window.ppResendViaKelly({
              journeyId: btn.getAttribute('data-journey'),
              patientId: btn.getAttribute('data-patient'),
              amount: Number(btn.getAttribute('data-amount') || 0),
            });
            window.ppToast?.('Sent via Kelly', 'success');
            await mountPipelineTab(root);
          } catch (e) {
            window.ppToast?.(e.message || 'Send failed', 'error');
          } finally {
            btn.disabled = false;
          }
        });
      });
    } catch (e) {
      root.innerHTML = `<div class="pp-empty">Error: ${UI().escapeHtml(e.message)}</div>`;
    }
  }

  window.mountPipelineTab = mountPipelineTab;
})();
