'use strict';

/**
 * Map SQL aggregate row → calendar-range billing fields (see PHOTO_TO_BILL_EXTRACTION_TODOS B1–B3).
 */

function billingVisualFromAgg({ event_count, has_due, all_paid }) {
  const n = Number(event_count || 0);
  if (n <= 0) return null;
  if (has_due) return 'due';
  if (all_paid) return 'paid';
  return 'review';
}

function fieldsFromSqlAggRow(row) {
  if (!row) {
    return {
      billing_has_due: false,
      billing_has_paid: false,
      billing_all_paid: false,
      billing_event_count: 0,
      billing_due_cents: 0,
      billing_paid_cents: 0,
      billing_visual: null
    };
  }

  const event_count = Number(row.event_count ?? 0);
  const has_due = Boolean(row.has_due);
  const has_paid = Boolean(row.has_paid);
  const all_paid = Boolean(row.all_paid);
  const billing_visual =
    row.billing_visual != null ? row.billing_visual : billingVisualFromAgg({ event_count, has_due, all_paid });

  return {
    billing_has_due: has_due,
    billing_has_paid: has_paid,
    billing_all_paid: all_paid,
    billing_event_count: event_count,
    billing_due_cents: Number(row.due_cents ?? 0),
    billing_paid_cents: Number(row.paid_cents ?? 0),
    billing_visual
  };
}

module.exports = {
  billingVisualFromAgg,
  fieldsFromSqlAggRow
};
