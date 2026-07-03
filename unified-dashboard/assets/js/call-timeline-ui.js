/**
 * Patient-friendly call timeline table (FD-187, FD-224).
 */
(function (global) {
  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function formatTime(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (_) {
      return iso;
    }
  }

  function renderTimelineTable(timeline, opts = {}) {
    const rows = Array.isArray(timeline) ? timeline : [];
    if (!rows.length) {
      return opts.emptyHtml || '<p class="sfd-muted">No timeline events for this call.</p>';
    }
    const body = rows
      .map(
        (row) =>
          `<tr><td class="sfd-mono sfd-timeline-time">${escapeHtml(formatTime(row.at))}</td><td>${escapeHtml(row.label || row.event || '—')}${row.detail ? ` <span class="sfd-muted">(${escapeHtml(row.detail)})</span>` : ''}</td></tr>`
      )
      .join('');
    return `<table class="sfd-table sfd-timeline-table" aria-label="Call timeline"><thead><tr><th scope="col">Time</th><th scope="col">Event</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  function renderCallChips(call, opts = {}) {
    const chips = [];
    const NP = global.SfdNameplate;
    if (!NP?.renderChip) return '';

    const elig = String(call?.eligibility_status || '').toLowerCase();
    if (elig === 'verified' || elig === 'eligible') {
      chips.push(NP.renderChip('VERIFIED'));
    } else if (elig === 'pending' || elig === 'pending_verification') {
      chips.push(NP.renderChip('SYNC PENDING'));
    }

    if (call?.payment_link_sent || call?.pay_link_sent) {
      chips.push(NP.renderChip('LINK SENT'));
    }

    if (call?.pms_sync_pending || call?.sync_pending) {
      chips.push(NP.renderChip('SYNC PENDING'));
    }

    if (!chips.length && opts.transferOnly) return '';
    return chips.length
      ? `<div class="sfd-call-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0">${chips.join('')}</div>`
      : '';
  }

  function renderCallDetailStates(call, summary = {}) {
    const transferOnly =
      summary.transfer_only ||
      (call?.disposition === 'transferred' && !call?.eligibility_status && !summary.booking_outcome);
    const eligPending =
      String(call?.eligibility_status || summary.eligibility_status || '').toLowerCase() === 'pending';
    const syncPending = !!(call?.pms_sync_pending || summary.pms_sync_pending);

    let notice = '';
    if (transferOnly) {
      notice =
        '<div class="sfd-callout"><b>Transfer-only call.</b> Kelly handed off to your office — no booking or insurance steps on this call.</div>';
    } else if (eligPending) {
      notice =
        '<div class="sfd-callout"><b>Insurance verification pending.</b> Kelly collected details — your team can finish verification in the chart.</div>';
    } else if (syncPending) {
      notice =
        '<div class="sfd-callout"><b>Manual Dentrix sync pending.</b> This booking is in your daily digest until two-way sync is live.</div>';
    }
    return { transferOnly, eligPending, syncPending, notice };
  }

  global.CallTimelineUi = {
    renderTimelineTable,
    renderCallChips,
    renderCallDetailStates,
    formatTime
  };
})(typeof window !== 'undefined' ? window : global);
