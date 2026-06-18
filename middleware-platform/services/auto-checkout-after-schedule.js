'use strict';

const axios = require('axios');
const db = require('../database');

// Prevent duplicate checkout creation when multiple scheduling flows converge
// on the same appointment around the same time.
const inFlightByAppointment = new Map();
const recentResultByAppointment = new Map();
const RECENT_RESULT_TTL_MS = 2 * 60 * 1000;

function isAutoCheckoutEnabled({ customer_type } = {}) {
  const env = process.env.AUTO_CHECKOUT_AFTER_SCHEDULE;
  if (env === '0' || env === 'false') return false;
  if (env === '1' || env === 'true') return true;
  const type = String(customer_type || 'saas').toLowerCase();
  return type === 'saas';
}

function keyFor(appointmentId, clinicId) {
  return `${clinicId || 'unknown'}:${appointmentId || 'unknown'}`;
}

function getRecentResult(key) {
  const cached = recentResultByAppointment.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    recentResultByAppointment.delete(key);
    return null;
  }
  return cached.value;
}

/**
 * After a successful BookingService.scheduleAppointment, optionally create a voice checkout
 * (payment token + email code flow). Used by:
 * - POST /voice/appointments/schedule
 * - POST /api/appointments/schedule (legacy)
 * - patient-orchestrator-service (fallback booking)
 *
 * @param {object} params
 * @param {string} params.base - API base URL (no trailing slash)
 * @param {string} params.appointmentId
 * @param {string} [params.patient_phone]
 * @param {string} [params.patient_email]
 * @param {string} [params.patient_name]
 * @param {string} params.clinic_id
 * @param {string} [params.appointment_type]
 * @param {string|null} [params.triage_session_id] - Retell callId / Kelly session for audit (C9)
 * @param {number} [params.timeoutMs]
 * @returns {Promise<{ checkout_id, payment_token, amount, requires_verification }|null>}
 */
async function autoCheckoutAfterSchedule(params) {
  const {
    base,
    appointmentId,
    patient_phone,
    patient_email,
    patient_name,
    clinic_id,
    appointment_type,
    triage_session_id = null,
    customer_type = null,
    timeoutMs = Number(process.env.AUTO_CHECKOUT_TIMEOUT_MS || 45000)
  } = params;

  if (!appointmentId || !clinic_id) return null;
  if (!isAutoCheckoutEnabled({ customer_type })) return null;

  // DB guard: if checkout already exists for this appointment, do not create another.
  try {
    const existing = db.db?.prepare(
      'SELECT id, status FROM voice_checkouts WHERE appointment_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(appointmentId);
    if (existing?.id) {
      return {
        skipped: true,
        existing_checkout_id: existing.id,
        status: existing.status || null
      };
    }
  } catch (_) {}

  const dedupeKey = keyFor(appointmentId, clinic_id);
  const cachedResult = getRecentResult(dedupeKey);
  if (cachedResult) return cachedResult;

  if (inFlightByAppointment.has(dedupeKey)) {
    return inFlightByAppointment.get(dedupeKey);
  }

  const requestPromise = (async () => {
    const body = {
      appointment_id: appointmentId,
      triage_session_id: triage_session_id || null,
      // A4/A10: Keep payload contract consistent for both Retell and API callers.
      customer_phone: patient_phone,
      customer_email: patient_email,
      customer_name: patient_name,
      patient_phone,
      patient_email,
      patient_name,
      clinic_id,
      appointment_type
    };
    if (triage_session_id) {
      body.session_id = triage_session_id;
      body.call_id = triage_session_id;
      body.metadata = { session_id: triage_session_id };
    }

    const runCreateCheckout = async (attempt) => {
      return axios.post(`${base.replace(/\/$/, '')}/voice/appointments/checkout`, body, {
        timeout: timeoutMs
      }).catch((error) => {
        const isTimeout = error?.code === 'ECONNABORTED' || /timeout/i.test(String(error?.message || ''));
        // Chk-C2: one retry for slow email/checkout path before giving up.
        if (attempt < 2 && isTimeout) {
          return runCreateCheckout(attempt + 1);
        }
        throw error;
      });
    };
    const checkoutRes = await runCreateCheckout(1);

    const d = checkoutRes.data;
    if (d && d.success) {
      const result = {
        checkout_id: d.checkout_id,
        payment_token: d.payment_token,
        amount: d.amount,
        requires_verification: !!d.requires_verification
      };
      recentResultByAppointment.set(dedupeKey, {
        value: result,
        expiresAt: Date.now() + RECENT_RESULT_TTL_MS
      });
      return result;
    }
    return null;
  })();

  inFlightByAppointment.set(dedupeKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    inFlightByAppointment.delete(dedupeKey);
  }
}

module.exports = { autoCheckoutAfterSchedule, isAutoCheckoutEnabled };
