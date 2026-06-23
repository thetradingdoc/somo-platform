'use strict';

/** Pivot events emitted when utterance triggers mode change. */
const PivotEvent = Object.freeze({
  BILLING_INTENT_DETECTED: 'billing_intent_detected',
  SYMPTOM_INTENT_DETECTED: 'symptom_intent_detected',
  RECORDS_INTENT_DETECTED: 'records_intent_detected',
  EMERGENCY_DETECTED: 'emergency_detected',
  CANCEL_INTENT_DETECTED: 'cancel_intent_detected',
  BOOK_INTENT_DETECTED: 'book_intent_detected',
  HANDOFF_INTENT_DETECTED: 'handoff_intent_detected'
});

const ALL_PIVOT_EVENTS = Object.values(PivotEvent);

function isPivotEvent(v) {
  return ALL_PIVOT_EVENTS.includes(v);
}

module.exports = { PivotEvent, ALL_PIVOT_EVENTS, isPivotEvent };
