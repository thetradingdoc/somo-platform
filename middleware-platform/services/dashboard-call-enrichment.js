'use strict';

const { normalizeDisposition } = require('./disposition-taxonomy');

function parsePayload(raw) {
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return {};
  }
}

function lookupSessionEnrichment(dbModule, sessionId) {
  if (!sessionId || !dbModule?.db) {
    return {
      disposition: null,
      eligibility_status: null,
      copay_quote: null,
      copay_spoken: null
    };
  }

  let disposition = null;
  let eligibility_status = null;
  let copay_quote = null;
  let copay_spoken = null;

  try {
    const events = dbModule.db
      .prepare(
        `
        SELECT event_type, payload_json FROM kelly_call_events
        WHERE session_id = ? OR call_id = ?
        ORDER BY created_at DESC LIMIT 80
      `
      )
      .all(sessionId, sessionId);
    for (const ev of events) {
      const p = parsePayload(ev.payload_json);
      if (
        ev.event_type === 'eligibility_complete' ||
        ev.event_type === 'internal_eligibility_complete' ||
        ev.event_type === 'eligibility_checked'
      ) {
        eligibility_status = p.status || p.eligibility_status || eligibility_status || 'verified';
        if (p.copay_amount != null) copay_quote = Number(p.copay_amount);
        else if (p.copayCents != null) copay_quote = Number(p.copayCents) / 100;
      }
      if (p.disposition) {
        disposition = normalizeDisposition(p.disposition);
      }
      if (ev.event_type === 'call_completed' && p.disposition) {
        disposition = normalizeDisposition(p.disposition);
      }
    }
  } catch (_) {}

  try {
    const routing = dbModule.db
      .prepare(`SELECT eligibility_status, copay_cents FROM health_session_routing WHERE session_id = ? LIMIT 1`)
      .get(sessionId);
    if (routing) {
      eligibility_status = eligibility_status || routing.eligibility_status || null;
      if (routing.copay_cents != null && copay_quote == null) {
        copay_quote = Number(routing.copay_cents) / 100;
      }
    }
  } catch (_) {}

  try {
    const amt = dbModule.db
      .prepare(
        `
        SELECT quoted_amount, charged_amount, source, status FROM amount_resolution_log
        WHERE session_id = ? ORDER BY created_at DESC LIMIT 1
      `
      )
      .get(sessionId);
    if (amt) {
      if (amt.quoted_amount != null && copay_quote == null) copay_quote = Number(amt.quoted_amount);
      if (amt.charged_amount != null) copay_spoken = Number(amt.charged_amount);
      else if (amt.status === 'spoken' && copay_quote != null) copay_spoken = copay_quote;
    }
  } catch (_) {}

  return {
    disposition,
    eligibility_status,
    copay_quote,
    copay_spoken
  };
}

function enrichCallRow(dbModule, call) {
  const sessionId = call.call_id || call.id;
  const extra = lookupSessionEnrichment(dbModule, sessionId);
  return {
    ...call,
    ...extra,
    disposition: extra.disposition || call.outcome || call.disposition || null
  };
}

function formatCopayDisplay(amount) {
  if (amount == null || Number.isNaN(Number(amount))) return null;
  return `$${Number(amount).toFixed(2)}`;
}

module.exports = {
  lookupSessionEnrichment,
  enrichCallRow,
  formatCopayDisplay
};
