'use strict';

const db = require('../database');

function resolveOwnerEmail(clinicId, customerId) {
  try {
    if (clinicId) {
      const clinic = db.getClinicById?.(clinicId);
      if (clinic?.email) return clinic.email;
    }
    if (customerId) {
      const customer = db.getCustomer?.(customerId);
      if (customer?.email) return customer.email;
    }
  } catch (_) {}
  return null;
}

function buildOwnerEmail({ eventType, patientName, payload = {} }) {
  const name = patientName || 'A patient';
  switch (eventType) {
    case 'appointment_booked':
      return {
        subject: `Kelly booked an appointment — ${name}`,
        html: `<p>Kelly booked an appointment for <strong>${name}</strong>${
          payload.appointment_type ? ` (${payload.appointment_type})` : ''
        }.</p><p>Session: ${payload.session_id || 'n/a'}</p>`
      };
    case 'appointment_cancelled':
      return {
        subject: `Kelly canceled an appointment — ${name}`,
        html: `<p>Kelly canceled an appointment for <strong>${name}</strong>.</p><p>Session: ${
          payload.session_id || 'n/a'
        }</p>`
      };
    case 'payment_link_sent':
      return {
        subject: `Kelly sent a payment link — ${name}`,
        html: `<p>Kelly sent a secure payment link to <strong>${name}</strong>${
          payload.amount != null ? ` for $${Number(payload.amount).toFixed(2)}` : ''
        }.</p>`
      };
    default:
      return null;
  }
}

/**
 * Notify clinic owner on high-value Kelly outcomes (non-blocking).
 */
async function sendPostCallOwnerEmail({
  eventType,
  sessionId,
  clinicId,
  customerId,
  patientId,
  patientName,
  payload = {}
} = {}) {
  const supported = new Set(['appointment_booked', 'appointment_cancelled', 'payment_link_sent']);
  if (!supported.has(eventType)) return { skipped: true, reason: 'unsupported_event' };

  const to = resolveOwnerEmail(clinicId, customerId);
  if (!to) return { skipped: true, reason: 'no_owner_email' };

  const EmailService = require('./email-service');
  const body = buildOwnerEmail({
    eventType,
    patientName,
    payload: { ...payload, session_id: sessionId, patient_id: patientId }
  });
  if (!body) return { skipped: true, reason: 'no_template' };

  try {
    return await EmailService.sendEmail({
      to,
      subject: body.subject,
      html: body.html,
      text: body.subject
    });
  } catch (err) {
    console.warn('[post-call-owner-email] send failed:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendPostCallOwnerEmail, resolveOwnerEmail, buildOwnerEmail };
