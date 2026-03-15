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
