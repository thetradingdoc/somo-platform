/**
 * Telemedicine Phase 5 — Automated reminders (Tasks 34–38).
 * No PHI in message bodies: only appointment time, upload link, join link.
 */
const db = require('../database');
const EmailService = require('./email-service');
const { createUploadToken } = require('../utils/upload-token');

const UPLOAD_PORTAL_PATH = process.env.UPLOAD_PORTAL_PATH || '/upload';

function getBaseUrl() {
  const b = process.env.API_BASE_URL || process.env.BASE_URL || '';
  if (b) return b.replace(/\/$/, '');
  return 'http://localhost:4000';
}

/**
 * Build upload portal URL for a patient/appointment and optionally create a new token.
 * @param {string} patientId - FHIR patient resource_id
 * @param {string|null} appointmentId - appointment id or null
 * @param {number} expiresInMs - token lifetime (default 24h)
 * @returns {{ uploadUrl: string, token: string }|null} null if patientId missing
 */
function buildUploadLinkForAppointment(patientId, appointmentId = null, expiresInMs = 24 * 60 * 60 * 1000) {
  if (!patientId) return null;
  const expiresAt = new Date(Date.now() + expiresInMs);
  const token = createUploadToken(patientId, appointmentId, expiresAt);
  db.createUploadToken({
    token,
    patient_id: patientId,
    appointment_id: appointmentId,
    expires_at: expiresAt.toISOString(),
    used: 0,
    max_files: 10,
    max_bytes: 52428800
  });
  const baseUrl = getBaseUrl();
  const uploadUrl = `${baseUrl}${UPLOAD_PORTAL_PATH.startsWith('/') ? '' : '/'}${UPLOAD_PORTAL_PATH}?token=${encodeURIComponent(token)}`;
  return { uploadUrl, token };
}

/**
 * Build video join link for 1h reminder (Task 37).
 */
function buildJoinLink(appointment) {
  const baseUrl = process.env.DASHBOARD_BASE_URL || process.env.BASE_URL || process.env.API_BASE_URL || 'http://localhost:4000';
  const roomName = appointment.video_room_name || `appt-${appointment.id}`;
  return `${baseUrl.replace(/\/$/, '')}/patients/video-call.html?room=${encodeURIComponent(roomName)}`;
}

/**
 * Task 35: On booking — send SMS + email with appointment time and upload link; set reminder_booking_sent.
 * Call after createAppointment. No PHI beyond appointment time and links.
 */
async function sendBookingConfirmationWithUploadLink(appointment) {
  let uploadUrl = null;
  if (appointment.patient_id) {
    const built = buildUploadLinkForAppointment(appointment.patient_id, appointment.id, 7 * 24 * 60 * 60 * 1000);
    if (built) uploadUrl = built.uploadUrl;
  }

  const dateTimeStr = appointment.start_time
    ? new Date(appointment.start_time).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: appointment.timezone || 'America/New_York'
      })
    : `${appointment.date} at ${appointment.time}`;

  if (appointment.patient_email) {
    try {
      await EmailService.sendAppointmentConfirmation(appointment, { uploadLink: uploadUrl });
      console.log('✅ Booking confirmation email sent (with upload link)');
    } catch (e) {
      console.warn('⚠️ Booking confirmation email failed:', e.message);
    }
  }

  let SMSService;
  try {
    SMSService = require('./sms-service');
  } catch (_) {
    SMSService = null;
  }
  if (SMSService && appointment.patient_phone) {
    try {
      const smsText = uploadUrl
        ? `DocLittle: Your appointment is confirmed for ${dateTimeStr}. Upload documents: ${uploadUrl}`
        : `DocLittle: Your appointment is confirmed for ${dateTimeStr}.`;
      const res = await SMSService.sendSMS(appointment.patient_phone, smsText);
      if (res && res.success) console.log('✅ Booking confirmation SMS sent');
    } catch (e) {
      console.warn('⚠️ Booking confirmation SMS failed:', e.message);
    }
  }

  if (db.markReminderBookingSent) {
    db.markReminderBookingSent(appointment.id, appointment.clinic_id || null);
  }
}

module.exports = {
  buildUploadLinkForAppointment,
  buildJoinLink,
  sendBookingConfirmationWithUploadLink,
  getBaseUrl
};
