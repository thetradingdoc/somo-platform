'use strict';

/**
 * Copay payment idempotency keyed on call_id + appointment_id (PO-P0-6).
 */
function buildCopayIdempotencyKey({ callId, appointmentId, sessionId, customerId } = {}) {
  const call = callId ? String(callId).trim() : null;
  const appt = appointmentId ? String(appointmentId).trim() : null;
  if (call && appt) return `copay:${call}:${appt}`;
  const session = sessionId ? String(sessionId).trim() : null;
  if (session && appt) return `copay:session:${session}:${appt}`;
  if (customerId && appt) return `copay:customer:${customerId}:${appt}`;
  return null;
}

function extractCopayKeysFromRequest(requestData = {}) {
  const meta = requestData.metadata || {};
  return {
    callId: meta.call_id || meta.callId || requestData.call_id || null,
    appointmentId: meta.appointment_id || meta.appointmentId || requestData.appointment_id || null,
    sessionId: meta.kelly_session_id || meta.session_id || requestData.session_id || null,
    customerId: meta.customer_id || requestData.customer_id || null
  };
}

module.exports = { buildCopayIdempotencyKey, extractCopayKeysFromRequest };
