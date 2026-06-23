'use strict';

/**
 * Canonical L2 subrail phases ↔ L4 lane steps.
 * L2 subrails use BookingPhase/CancelPhase; L4 gates use L4_*_STEP.
 */

const BookingPhase = Object.freeze({
  SLOT_LOOKUP: 'slot_lookup',
  SLOT_SELECT: 'slot_select',
  CONTACT_CONFIRM: 'contact_confirm',
  SCHEDULE: 'schedule',
  CONFIRM: 'confirm'
});

const L4_BOOKING_STEP = Object.freeze({
  SCHEDULE_VISIT: 'schedule_visit',
  CONFIRM_VISIT: 'confirm_visit'
});

const CancelPhase = Object.freeze({
  FIND_BOOKING: 'find_booking',
  CONFIRM_CANCEL: 'confirm_cancel',
  CANCEL_EXECUTE: 'cancel_execute',
  CONFIRM_MESSAGE: 'confirm_message'
});

const L4_CANCEL_STEP = Object.freeze({
  FIND_BOOKING: 'find_booking',
  MOVE_OR_CANCEL: 'move_or_cancel'
});

const RecordsPhase = Object.freeze({
  RECORDS_QA: 'records_qa'
});

const L4_RECORDS_STEP = Object.freeze({
  RECORDS_QA: 'records_qa',
  FHIR_READ: 'fhir_read'
});

const GATE_OUTCOME = Object.freeze({
  BOOKED: 'booked',
  CANCELLED: 'cancelled',
  RESCHEDULED: 'rescheduled',
  NO_AVAILABILITY: 'no_availability',
  FAILED: 'failed',
  HANDLED: 'handled',
  LLM: 'llm',
  GATE_PROCESSING: 'gate_processing'
});

function l2BookingPhaseToL4Step(phase, flags = {}) {
  const p = String(phase || '').toLowerCase();
  const hasBookableSlot =
    !!(flags.current_booking_slot?.date && flags.current_booking_slot?.time) ||
    !!flags._slot_selected_time;
  if (['contact_confirm', 'schedule', 'confirm'].includes(p) && hasBookableSlot && !flags.no_provider_availability) {
    return L4_BOOKING_STEP.CONFIRM_VISIT;
  }
  if (['slot_lookup', 'slot_select'].includes(p)) {
    return L4_BOOKING_STEP.SCHEDULE_VISIT;
  }
  return L4_BOOKING_STEP.SCHEDULE_VISIT;
}

function l2CancelPhaseToL4Step(phase, flags = {}) {
  const p = String(phase || '').toLowerCase();
  if (flags.appt_lookup_only) return L4_CANCEL_STEP.FIND_BOOKING;
  if (flags.reschedule_pending) {
    if (flags.lookup_complete || flags.current_booking_slot?.date) {
      return L4_CANCEL_STEP.MOVE_OR_CANCEL;
    }
    return L4_CANCEL_STEP.FIND_BOOKING;
  }
  if (p === CancelPhase.FIND_BOOKING) return L4_CANCEL_STEP.FIND_BOOKING;
  if (
    p === CancelPhase.CANCEL_EXECUTE ||
    flags.cancel_pending ||
    flags.cancel_confirmed
  ) {
    return L4_CANCEL_STEP.MOVE_OR_CANCEL;
  }
  return L4_CANCEL_STEP.FIND_BOOKING;
}

function l2RecordsPhaseToL4Step() {
  return L4_RECORDS_STEP.RECORDS_QA;
}

function l4StepToBookingPhase(step) {
  if (step === L4_BOOKING_STEP.CONFIRM_VISIT) return BookingPhase.CONFIRM;
  return BookingPhase.SLOT_LOOKUP;
}

module.exports = {
  BookingPhase,
  L4_BOOKING_STEP,
  CancelPhase,
  L4_CANCEL_STEP,
  RecordsPhase,
  L4_RECORDS_STEP,
  GATE_OUTCOME,
  l2BookingPhaseToL4Step,
  l2CancelPhaseToL4Step,
  l2RecordsPhaseToL4Step,
  l4StepToBookingPhase
};
