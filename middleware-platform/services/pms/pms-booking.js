'use strict';

/**
 * Single entry point for scheduling — routes through PMS hub when enabled.
 */
const BookingService = require('../booking-service');
const { PmsHub } = require('./pms-hub');

const degradedLogClinics = new Set();

function logDegradedOnce(clinicId, action) {
  const key = `${clinicId || 'unknown'}:${action}`;
  if (degradedLogClinics.has(key)) return;
  degradedLogClinics.add(key);
  console.warn(`[pms-booking] PMS hub unavailable for clinic ${clinicId || 'n/a'} — using BookingService (${action})`);
}

function hubFor(clinicId) {
  if (!clinicId) return null;
  return PmsHub.tryForClinic(clinicId);
}

async function getAvailableSlots(date, provider, appointmentType, timezone, clinicId, practitionerId) {
  const hub = hubFor(clinicId);
  if (hub) {
    return hub.getSchedule({
      date,
      provider,
      appointment_type: appointmentType,
      timezone,
      practitioner_id: practitionerId
    });
  }
  logDegradedOnce(clinicId, 'getAvailableSlots');
  return BookingService.getAvailableSlots(
    date,
    provider,
    appointmentType,
    timezone,
    clinicId,
    practitionerId
  );
}

async function scheduleAppointment(appointmentData, opts = {}) {
  const clinicId = appointmentData?.clinic_id;
  const hub = hubFor(clinicId);
  if (hub) {
    return hub.bookAppointment(appointmentData, {
      idempotency_key: opts.idempotency_key || appointmentData.idempotency_key || null,
      ip: opts.ip
    });
  }
  logDegradedOnce(clinicId, 'scheduleAppointment');
  return BookingService.scheduleAppointment(appointmentData);
}

async function rescheduleAppointment(appointmentId, newDate, newTime, reason, timezone, clinicId, opts = {}) {
  const hub = hubFor(clinicId);
  if (hub) {
    return hub.rescheduleAppointment(appointmentId, newDate, newTime, reason, timezone, opts);
  }
  return BookingService.rescheduleAppointment(appointmentId, newDate, newTime, reason, timezone, clinicId);
}

async function cancelAppointment(appointmentId, reason, clinicId, opts = {}) {
  const hub = hubFor(clinicId);
  if (hub) {
    return hub.cancelAppointment(appointmentId, reason, opts);
  }
  return BookingService.cancelAppointment(appointmentId, reason, clinicId);
}

async function searchAppointments(searchTerm, clinicId) {
  return BookingService.searchAppointments(searchTerm, clinicId);
}

module.exports = {
  getAvailableSlots,
  scheduleAppointment,
  rescheduleAppointment,
  cancelAppointment,
  searchAppointments,
  hubFor
};
