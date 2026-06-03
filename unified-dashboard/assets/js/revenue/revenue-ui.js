/**
 * Shared Revenue hub UI helpers — design spec components.
 */
(function () {
  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  function iconHtml(name) {
    return typeof window.getNavIcon === 'function' ? window.getNavIcon(name) : '';
  }

  function resolveHref(href) {
    if (typeof window.resolveBusinessPath === 'function') return window.resolveBusinessPath(href);
    return href;
  }

  const STAGE_TONE = {
    pre_registration: 't',
    registration: 't',
    charge_capture: 'a',
    prior_authorization: 'a',
    medical_coding: 'a',
    cdi: 'r',
    claim_submission: 'a',
    remittance_processing: 't',
    follow_up_phone: 'a',
    patient_collection: 'r',
    bill: 'a',
  };

  const STAGE_ICON = {
    pre_registration: 'clipboard',
    registration: 'user-check',
    bill: 'clock',
    patient_collection: 'exclamation-triangle',
    follow_up_phone: 'phone',
    prior_authorization: 'document-text',
    cdi: 'exclamation-triangle',
  };

  window.RevenueUI = {
    escapeHtml,
    resolveHref,
    iconHtml,

    renderKpiRow(items, cols) {
      const colClass = cols === 3 ? 'pp-kpi-row-3' : 'pp-kpi-row-4';
      return `<div class="pp-kpi-row ${colClass}">${(items || [])
        .map(
          (k) => `<div class="pp-kpi">
          <div class="pp-kpi-eyebrow">${escapeHtml(k.label)}</div>
          <div class="pp-kpi-val${k.tone ? ` pp-kpi-val--${k.tone}` : ''}">${escapeHtml(k.value)}</div>
        </div>`
        )
        .join('')}</div>`;
    },

    renderSectionLabel(text) {
      return `<div class="pp-section-label">${escapeHtml(text)}</div>`;
    },

    renderStatusPill(status) {
      const st = String(status || '').toLowerCase();
      let cls = 'neutral';
      if (['paid', 'approved', 'complete', 'completed'].includes(st)) cls = 'paid';
      else if (['denied', 'denial', 'rejected', 'cdi'].includes(st)) cls = 'denied';
      else if (['open', 'requested', 'sent', 'pending', 'collection', 'bill'].includes(st)) cls = 'open';
      const label = st === 'patient_collection' ? 'Collection' : status;
      return `<span class="pp-status-pill pp-status-pill--${cls}">${escapeHtml(label)}</span>`;
    },

    renderJourneyChip(stageId, count, label) {
      const stage = String(stageId || '').toLowerCase().replace(/\s+/g, '_');
      const tone = STAGE_TONE[stage] || 't';
      const chipClass = tone === 'r' ? 'pp-chip-r' : tone === 'a' ? 'pp-chip-a' : 'pp-chip-t';
      const iconKey = STAGE_ICON[stage] || 'clipboard';
      const href =
        typeof window.ppJourneyStageHref === 'function'
          ? resolveHref(window.ppJourneyStageHref(stage))
          : resolveHref('revenue.html?tab=pipeline');
      const text = `${label || stage.replace(/_/g, ' ')} · ${Number(count || 0)}`;
      return `<a class="pp-journey-chip--pill ${chipClass}" href="${escapeHtml(href)}">
        <span class="pp-inline-icon" aria-hidden="true">${iconHtml(iconKey)}</span>
        ${escapeHtml(text)}
      </a>`;
    },

    renderEmptyState(iconKey, message) {
      return `<div class="pp-revenue-empty">
        <div class="pp-revenue-empty-icon" aria-hidden="true">${iconHtml(iconKey)}</div>
        <div class="pp-revenue-empty-text">${escapeHtml(message)}</div>
      </div>`;
    },

    renderTable({ colsClass, columns, rows }) {
      const head = `<div class="pp-table-header ${colsClass}">${columns
        .map((c) => `<span>${escapeHtml(c)}</span>`)
        .join('')}</div>`;
      const body = (rows || [])
        .map(
          (cells) =>
            `<div class="pp-table-row ${colsClass}">${cells.join('')}</div>`
        )
        .join('');
      return `<div class="pp-table-wrap">${head}${body || `<div class="pp-table-row ${colsClass}"><span style="grid-column:1/-1;color:var(--muted)">No rows</span></div>`}</div>`;
    },

    btnPrimary(label, attrs) {
      return `<button type="button" class="pp-btn pp-btn-primary pp-btn-sm"${attrs || ''}>${escapeHtml(label)}</button>`;
    },

    btnOutline(label, attrs) {
      return `<button type="button" class="pp-btn pp-btn-outline pp-btn-sm"${attrs || ''}>${escapeHtml(label)}</button>`;
    },

    renderTableActions(parts) {
      const html = (parts || []).filter(Boolean).join('');
      return `<span class="pp-table-actions">${html}</span>`;
    },
  };
})();
