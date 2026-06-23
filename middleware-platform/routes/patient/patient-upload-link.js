/**
 * Telemedicine Phase 3 — Task 21 & 22: Send upload link to patient (email).
 * POST /api/patient/send-upload-link
 * Accepts patient_id OR patient_email OR patient_phone; optional appointment_id.
 * Resolves FHIR patient, creates upload token, sends email (Task 22 template), returns { sent, channel, expires_at }.
 */
const express = require('express');
const router = express.Router();
const db = require('../../database');
const EmailService = require('../../services/platform/email-service');
const { createUploadToken } = require('../../utils/upload-token');
const SMSService = require('../../services/platform/sms-service');

const UPLOAD_PORTAL_PATH = process.env.UPLOAD_PORTAL_PATH || '/upload';

function getBaseUrl() {
  const b = process.env.API_BASE_URL || process.env.BASE_URL || '';
  if (b) return b.replace(/\/$/, '');
  return 'http://localhost:4000';
}

/**
 * Token expiry: min(consult_start - 30min, now + 48h). Default 48h when no appointment.
 */
function computeTokenExpiry(appointment_id) {
  const max48h = new Date(Date.now() + 48 * 60 * 60 * 1000);
  if (!appointment_id) return max48h;
  try {
    const apt = db.getAppointment && db.getAppointment(appointment_id);
    if (apt && apt.start_time) {
      const consultExpiry = new Date(new Date(apt.start_time).getTime() - 30 * 60 * 1000);
      const minExpiry = new Date(Date.now() + 5 * 60 * 1000);
      const clamped = consultExpiry < minExpiry ? minExpiry : consultExpiry;
      return clamped < max48h ? clamped : max48h;
    }
  } catch (_) {}
  return max48h;
}

/**
 * Task 22: Upload link email — no PHI in subject/body.
 * Subject: "Documents for your upcoming appointment"
 * Body: appointment date/time (if known), upload URL, what to include, link expiry.
 */
function buildUploadLinkEmail(to, uploadUrl, options = {}) {
  const { appointmentTime = null, expiresAt = null } = options;
  const expiresStr = expiresAt ? new Date(expiresAt).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }) : 'the link expires soon';

  let body = 'You can use the link below to securely upload documents before your visit.\n\n';
  if (appointmentTime) {
    body += `Appointment: ${appointmentTime}\n\n`;
  }
  body += `Upload link: ${uploadUrl}\n\n`;
  body += 'You can upload lab results (PDF) and photos (JPEG, PNG). The link will stop working after use or when it expires.\n\n';
  body += `Please complete your upload before ${expiresStr}.\n`;

  return {
    to,
    subject: 'Documents for your upcoming appointment',
    text: body,
    html: body.replace(/\n/g, '<br>')
  };
}

/**
 * Build SMS body for upload link (u-7: voice handoff).
 */
function buildUploadLinkSms(uploadUrl) {
  return `Upload documents for your visit: ${uploadUrl}\n\nThe link expires in 48 hours.`;
}

/**
 * Create upload token and send link via email or SMS.
 * Used by HTTP handler and PatientOrchestratorService (u-7 voice handoff).
 * @param {{ patient_id?: string, patient_email?: string, patient_phone?: string, appointment_id?: string, channel?: 'email'|'sms' }} opts
 * @returns {Promise<{ sent: boolean, channel: string, upload_url?: string, expires_at?: string, error?: string }>}
 */
async function createAndSendUploadLink(opts = {}) {
  const { patient_id, patient_email, patient_phone, appointment_id, channel: requestedChannel = 'email' } = opts;

  let patient = null;
  if (patient_id) {
    patient = db.getFHIRPatient(patient_id);
  }
  if (!patient && patient_email) {
    patient = db.getFHIRPatientByEmail((patient_email || '').trim());
  }
  if (!patient && patient_phone) {
    const normalized = SMSService.formatPhoneNumber ? SMSService.formatPhoneNumber(patient_phone) : patient_phone;
    patient = db.getFHIRPatientByPhone(normalized);
  }

  if (!patient) {
    return { sent: false, error: 'Patient not found' };
  }

  const patientId = patient.resource_id;
  const expiresAt = computeTokenExpiry(appointment_id || null);
  const token = createUploadToken(patientId, appointment_id || null, expiresAt);

  db.createUploadToken({
    token,
    patient_id: patientId,
    appointment_id: appointment_id || null,
    expires_at: expiresAt.toISOString(),
    used: 0,
    max_files: 10,
    max_bytes: 52428800
  });

  const baseUrl = getBaseUrl();
  const uploadUrl = `${baseUrl}${UPLOAD_PORTAL_PATH.startsWith('/') ? '' : '/'}${UPLOAD_PORTAL_PATH}?token=${encodeURIComponent(token)}`;

  let appointmentTime = null;
  if (appointment_id) {
    try {
      const apt = db.getAppointment && db.getAppointment(appointment_id);
      if (apt && apt.start_time) {
        appointmentTime = new Date(apt.start_time).toLocaleString('en-US', { weekday: 'short', dateStyle: 'medium', timeStyle: 'short' });
      }
    } catch (_) {}
  }

  if (requestedChannel === 'sms' && patient_phone) {
    const phone = SMSService.formatPhoneNumber ? SMSService.formatPhoneNumber(patient_phone) : patient_phone;
    const smsBody = buildUploadLinkSms(uploadUrl);
    const smsResult = await SMSService.sendSMS(phone, smsBody);
    return {
      sent: !!smsResult?.success,
      channel: 'sms',
      upload_url: uploadUrl,
      expires_at: expiresAt.toISOString(),
      error: smsResult?.error || null
    };
  }

  // Default: email
  const emailPayload = buildUploadLinkEmail(patient.email || patient_email, uploadUrl, {
    appointmentTime,
    expiresAt: expiresAt.toISOString()
  });

  if (!emailPayload.to) {
    return {
      sent: false,
      error: 'Patient has no email on file'
    };
  }

  const emailResult = await EmailService.sendEmail({
    to: emailPayload.to,
    subject: emailPayload.subject,
    html: emailPayload.html,
    text: emailPayload.text
  });

  return {
    sent: !!(emailResult?.success),
    channel: 'email',
    upload_url: uploadUrl,
    expires_at: expiresAt.toISOString(),
    error: emailResult?.error || null
  };
}

async function sendUploadLinkHandler(req, res) {
  try {
    const { patient_id, patient_email, patient_phone, appointment_id, channel } = req.body || {};
    const result = await createAndSendUploadLink({
      patient_id,
      patient_email,
      patient_phone,
      appointment_id,
      channel: channel || 'email'
    });

    if (!result.sent) {
      const status = result.error === 'Patient not found' ? 404 : (result.error?.includes('email') ? 400 : 500);
      return res.status(status).json({
        success: false,
        error: result.error || 'Failed to send',
        sent: false
      });
    }

    return res.json({
      success: true,
      sent: true,
      channel: result.channel,
      expires_at: result.expires_at
    });
  } catch (err) {
    console.error('[send-upload-link]', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal error',
      sent: false
    });
  }
}

router.post('/send-upload-link', sendUploadLinkHandler);

module.exports = router;
module.exports.sendUploadLinkHandler = sendUploadLinkHandler;
module.exports.computeTokenExpiry = computeTokenExpiry;
module.exports.createAndSendUploadLink = createAndSendUploadLink;
