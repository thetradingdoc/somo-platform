/**
 * LiveKit Video Conferencing Routes
 *
 * Token endpoint for joining LiveKit video rooms.
 * Used by doctor-patient telemedicine and in-app video.
 *
 * Room naming: appointment-linked rooms use appt-{appointment_id}
 *
 * Requires .env:
 *   LIVEKIT_URL        e.g. wss://your-project.livekit.cloud
 *   LIVEKIT_API_KEY    from cloud.livekit.io
 *   LIVEKIT_API_SECRET from cloud.livekit.io
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const PatientPortalService = require('../services/patient-portal-service');

let AccessToken;
try {
  const livekit = require('livekit-server-sdk');
  AccessToken = livekit.AccessToken;
} catch (e) {
  console.warn('⚠️  livekit-server-sdk not installed - LiveKit token endpoint disabled');
}

/**
 * OPTIONS /api/livekit/token
 * Handle CORS preflight
 */
router.options('/token', (req, res) => {
  console.log('🔍 OPTIONS /api/livekit/token - CORS preflight from:', req.headers.origin);
  res.status(204).end();
});

/**
 * POST /api/livekit/token
 * Get a token to join a LiveKit video room.
 *
 * Body: { room?: string, identity?: string, name?: string, appointment_id?: string }
 *   room          - Room name (optional; overridden by appointment_id)
 *   appointment_id - If provided, validates appointment exists and uses room appt-{id}
 *   identity      - Participant ID (default: "user-{uuid}")
 *   name          - Display name (default: "Participant")
 */
router.post('/token', async (req, res) => {
  console.log('🔍 POST /api/livekit/token - Request from:', req.headers.origin || 'no origin', 'IP:', req.ip);
  console.log('🔍 Request body:', JSON.stringify(req.body));
  if (!AccessToken) {
    return res.status(503).json({
      success: false,
      error: 'LiveKit not configured. Add LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET to .env'
    });
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl = process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !livekitUrl) {
    return res.status(503).json({
      success: false,
      error: 'LiveKit credentials missing. Get keys from https://cloud.livekit.io'
    });
  }

  try {
    const { v4: uuidv4 } = require('uuid');
    const appointmentId = req.body?.appointment_id?.trim();
    let room;

    if (appointmentId) {
      const appointment = await db.getAppointment(appointmentId);
      if (!appointment) {
        return res.status(404).json({
          success: false,
          error: 'Appointment not found'
        });
      }
      room = `appt-${appointmentId}`;
    } else {
      room = req.body?.room?.trim() || `telehealth-${uuidv4().slice(0, 8)}`;
    }

    const identity = req.body?.identity || `user-${uuidv4().slice(0, 8)}`;
    const name = req.body?.name || 'Participant';

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name,
      ttl: '2h'
    });

    const videoGrant = {
      roomJoin: true,
      room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    };

    at.addGrant(videoGrant);

    const token = await at.toJwt();

    const url = livekitUrl.startsWith('http') ? livekitUrl.replace(/^https?/, 'wss') : livekitUrl;
    res.json({
      success: true,
      token,
      url,
      room
    });
  } catch (err) {
    console.error('LiveKit token error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to create token'
    });
  }
});

module.exports = router;

/**
 * Patient-scoped helper for LiveKit token issuance.
 * Validates x-session-id + room belongs to patient's upcoming appointment.
 */
router.get('/patient/video/token', async (req, res) => {
  try {
    if (!AccessToken) {
      return res.status(503).json({ success: false, error: 'LiveKit not configured' });
    }
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !livekitUrl) {
      return res.status(503).json({ success: false, error: 'LiveKit credentials missing' });
    }

    const sessionId = req.headers['x-session-id'] || req.query.session_id;
    const room = (req.query.room || '').toString().trim();
    const journeyId = (req.headers['x-journey-id'] || req.query.journey_id || '').toString().trim() || null;
    if (!sessionId || !room) {
      return res.status(400).json({ success: false, error: 'session_id and room are required' });
    }

    const sessionValidation = PatientPortalService.validateSession(sessionId);
    if (!sessionValidation.valid) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }

    // Resolve appointment from room naming convention appt-{id}
    let appointmentId = null;
    if (room.startsWith('appt-')) {
      appointmentId = room.substring('appt-'.length);
    }

    if (!appointmentId) {
      return res.status(400).json({ success: false, error: 'Unsupported room name for patient join' });
    }

    const appointment = await db.getAppointment(appointmentId);
    if (!appointment) {
      return res.status(404).json({ success: false, error: 'Appointment not found' });
    }

    // Ensure this appointment belongs to this patient (by patient_id/email/phone)
    const sessionEmail = (sessionValidation.email || '').toLowerCase().trim();
    const sessionPhone = sessionValidation.phone || null;
    if (
      appointment.patient_id &&
      sessionValidation.patient_id &&
      appointment.patient_id !== sessionValidation.patient_id
    ) {
      return res.status(403).json({ success: false, error: 'Not allowed to join this appointment' });
    }
    if (!appointment.patient_id) {
      const emailMatches =
        appointment.patient_email &&
        sessionEmail &&
        appointment.patient_email.toLowerCase().trim() === sessionEmail;
      const phoneMatches =
        appointment.patient_phone && sessionPhone && appointment.patient_phone === sessionPhone;
      if (!emailMatches && !phoneMatches) {
        return res.status(403).json({ success: false, error: 'Not allowed to join this appointment' });
      }
    }

    const { v4: uuidv4 } = require('uuid');
    const identity = `patient-${sessionValidation.patient_id || sessionEmail || uuidv4().slice(0, 8)}`;
    const name = 'Patient';

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name,
      ttl: '2h'
    });

    at.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    });

    const token = await at.toJwt();
    const url = livekitUrl.startsWith('http') ? livekitUrl.replace(/^https?/, 'wss') : livekitUrl;
    console.log('[LiveKit] 🎥 patient/video/token issued', {
      room,
      appointment_id: appointmentId,
      patient_id: sessionValidation.patient_id || null,
      journey_id: journeyId
    });
    return res.json({ success: true, token, url, room });
  } catch (err) {
    console.error('[LiveKit] patient/video/token error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to create token' });
  }
});
