'use strict';

const { billingVisualFromAgg } = require('./billing-calendar-agg');

const DUE_STATUSES = ['due', 'needs_review', 'tracked', 'pending', 'disputed'];

/**
 * Single GROUP BY query for patient journal calendar-range billing overlays.
 *
 * @param {import('better-sqlite3').Database} sqlite
 * @param {{ patientId?: string, sessionId: string, startIso: string, endIso: string }} opts
 * @returns {Array<object>}
 */
function fetchBillingAggregatesByDay(sqlite, { patientId, sessionId, startIso, endIso }) {
  if (!sqlite) return [];

  const where = [];
  const params = [];

  if (patientId) {
    where.push('(patient_id = ? OR session_id = ?)');
    params.push(String(patientId), String(sessionId));
  } else {
    where.push('session_id = ?');
    params.push(String(sessionId));
  }

  where.push(`service_date IS NOT NULL AND trim(service_date) != '' AND length(service_date) >= 10`);
  where.push(`substr(service_date, 1, 10) BETWEEN ? AND ?`);
  params.push(String(startIso).slice(0, 10), String(endIso).slice(0, 10));

  const sql = `
    SELECT
      substr(service_date, 1, 10) AS service_date,
      COUNT(*) AS event_count,
      MAX(CASE WHEN lower(status) = 'due' THEN 1 ELSE 0 END) AS has_due,
      MAX(CASE WHEN lower(status) = 'paid' THEN 1 ELSE 0 END) AS has_paid,
      MIN(CASE WHEN lower(status) = 'paid' THEN 1 ELSE 0 END) AS all_paid_min,
      SUM(CASE WHEN lower(status) IN (${DUE_STATUSES.map(() => '?').join(',')}) THEN COALESCE(amount_cents, 0) ELSE 0 END) AS due_cents,
      SUM(CASE WHEN lower(status) = 'paid' THEN COALESCE(amount_cents, 0) ELSE 0 END) AS paid_cents
    FROM patient_billing_events
    WHERE ${where.join(' AND ')}
    GROUP BY substr(service_date, 1, 10)
    ORDER BY service_date ASC
  `;

  const rows = sqlite.prepare(sql).all(...params, ...DUE_STATUSES.map((s) => s.toLowerCase()));

  return rows.map((r) => {
    const event_count = Number(r.event_count || 0);
    const has_due = Number(r.has_due) === 1;
    const has_paid = Number(r.has_paid) === 1;
    const all_paid = event_count > 0 && Number(r.all_paid_min) === 1;

    return {
      service_date: String(r.service_date),
      event_count,
      has_due,
      has_paid,
      all_paid,
      due_cents: Number(r.due_cents || 0),
      paid_cents: Number(r.paid_cents || 0),
      billing_visual: billingVisualFromAgg({ event_count, has_due, all_paid })
    };
  });
}

module.exports = {
  fetchBillingAggregatesByDay
};
