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
const PatientPortalService = require('../services/patient/patient-portal-service');

/** Verbose token-route logs: dev by default; set DEBUG_LIVEKIT=1 to enable in production. */
function livekitTokenDebugEnabled() {
  return process.env.NODE_ENV !== 'production' || process.env.DEBUG_LIVEKIT === '1';
}

/**
 * YYYY-MM-DD + HH:mm interpreted in IANA tz → UTC epoch ms (aligns with patient/calendar wall-clock).
 */
function wallClockToUtcMs(dateStr, timeStr, timeZone) {
  const tz = timeZone || 'America/New_York';
  const dm = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = String(timeStr || '').match(/^(\d{1,2}):(\d{2})/);
  if (!dm || !tm) return NaN;
  const y = +dm[1];
  const mo = +dm[2];
  const d = +dm[3];
  const h = +tm[1];
  const mi = +tm[2];
  const partsFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    calendar: 'gregory',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  function readParts(epochMs) {
    const o = {};
    for (const p of partsFormatter.formatToParts(new Date(epochMs))) {
      if (p.type !== 'literal') o[p.type] = parseInt(p.value, 10);
    }
    return o;
  }
  let t = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  for (let i = 0; i < 48; i++) {
    const p = readParts(t);
    if (p.year === y && p.month === mo && p.day === d && p.hour === h && p.minute === mi) return t;
    const diffMin = (h * 60 + mi) - (p.hour * 60 + p.minute);
    const diffDay = d - p.day;
    t += (diffMin + diffDay * 24 * 60) * 60 * 1000;
  }
  return NaN;
}

function patientAppointmentJoinBoundsMs(appointment) {
  const tz = appointment.timezone || process.env.DEFAULT_CLINIC_TZ || 'America/New_York';
  const dur =
    typeof appointment.duration_minutes === 'number' && appointment.duration_minutes > 0
      ? appointment.duration_minutes
      : 30;

  if (appointment.date && appointment.time) {
    const start = wallClockToUtcMs(appointment.date, appointment.time, tz);
    if (!Number.isNaN(start)) {
      return { startMs: start, endMs: start + dur * 60 * 1000, source: 'wall_clock' };
    }
  }

  const startMs = appointment.start_time ? new Date(appointment.start_time).getTime() : NaN;
  const endMs = appointment.end_time ? new Date(appointment.end_time).getTime() : NaN;
  if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
    return { startMs, endMs, source: 'iso' };
  }
  if (!Number.isNaN(startMs)) {
    return { startMs, endMs: startMs + dur * 60 * 1000, source: 'iso_start_only' };
  }
  return { startMs: NaN, endMs: NaN, source: 'none' };
}

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
  if (livekitTokenDebugEnabled()) {
    console.log('OPTIONS /api/livekit/token CORS preflight from:', req.headers.origin);
  }
  res.status(204).end();
});

/**
 * POST /api/livekit/token (L-1, L-2)
 * Get a token to join a LiveKit video room.
 *
 * SECURITY: This endpoint has no auth by design for backwards compatibility.
 * For patient joins, use GET /api/livekit/patient/video/token (requires x-session-id).
 * When using appointment_id, appointment is validated with clinic/customer scoping.
 *
 * Body: { room?: string, identity?: string, name?: string, appointment_id?: string, clinic_id?: string }
 *   room          - Room name (optional; overridden by appointment_id)
 *   appointment_id - If provided, validates appointment exists and uses room appt-{id} (L-2: scoped)
 *   clinic_id     - Optional; when provided with appointment_id, enforces tenant scope
 *   identity      - Participant ID (default: "user-{uuid}")
 *   name          - Display name (default: "Participant")
 */
router.post('/token', async (req, res) => {
  if (livekitTokenDebugEnabled()) {
    console.log('POST /api/livekit/token from:', req.headers.origin || 'no origin', 'IP:', req.ip);
  }
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
    let appointmentId = req.body?.appointment_id?.trim();
    const roomFromBody = req.body?.room?.trim();
    const requestClinicId = (req.body?.clinic_id || req.headers['x-clinic-id'] || '').toString().trim() || null;
    if (!appointmentId && roomFromBody && roomFromBody.startsWith('appt-')) {
      appointmentId = roomFromBody.substring('appt-'.length);
    }
    let room;

    if (appointmentId) {
      const appointment = await db.getAppointment(appointmentId, requestClinicId);
      if (!appointment) {
        return res.status(404).json({
          success: false,
          error: 'Appointment not found'
        });
      }
      // L-2: Enforce tenant scope - appointment must match requested clinic when provided
      if (requestClinicId && appointment.clinic_id !== requestClinicId) {
        return res.status(403).json({
          success: false,
          error: 'Appointment does not belong to this clinic'
        });
      }
      const caseNumber = db.getCaseNumberForAppointment && db.getCaseNumberForAppointment(appointment.id);
      room = caseNumber ? `case-${caseNumber}` : `appt-${appointmentId}`;
    } else {
      room = roomFromBody || `telehealth-${uuidv4().slice(0, 8)}`;
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

    const sessionId = req.headers['x-session-id'];
    const room = (req.query.room || '').toString().trim();
    const journeyId = (req.headers['x-journey-id'] || req.query.journey_id || '').toString().trim() || null;
    if (!sessionId || !room) {
      return res.status(400).json({ success: false, error: 'x-session-id and room are required' });
    }

    const sessionValidation = PatientPortalService.validateSession(sessionId);
    if (!sessionValidation.valid) {
      return res.status(401).json({ success: false, error: 'Invalid session' });
    }

    // Resolve appointment from room naming convention appt-{id} or case-{case_number}
    let appointmentId = null;
    let resolvedRoom = room;
    if (room.startsWith('appt-')) {
      appointmentId = room.substring('appt-'.length);
      const appointment = await db.getAppointment(appointmentId);
      if (appointment && db.getCaseNumberForAppointment) {
        const caseNumber = db.getCaseNumberForAppointment(appointment.id);
        if (caseNumber) resolvedRoom = `case-${caseNumber}`;
      }
    } else if (room.startsWith('case-')) {
      const caseNumber = room.substring('case-'.length);
      try {
        const cr = db.prepare('SELECT * FROM case_records WHERE case_number = ? LIMIT 1').get(caseNumber);
        if (cr && cr.session_id) {
          const s = db.prepare('SELECT flow_state FROM patient_orchestrate_sessions WHERE session_id = ? LIMIT 1').get(cr.session_id);
          if (s && s.flow_state) {
            const fs = typeof s.flow_state === 'string' ? JSON.parse(s.flow_state) : s.flow_state;
            appointmentId = fs.appointment_id || null;
          }
        }
      } catch (_) {}
    }

    if (!appointmentId && room.startsWith('appt-')) {
      appointmentId = room.substring('appt-'.length);
    }

    if (!appointmentId) {
      return res.status(400).json({ success: false, error: 'Unsupported room name for patient join' });
    }

    const appointment = await db.getAppointment(appointmentId);
    if (!appointment) {
      return res.status(404).json({ success: false, error: 'Appointment not found' });
    }

    // Enforce join window (mvp-26). Prefer legacy date+time in appointment.timezone (wall clock)
    // so we match provider/patient UIs; raw start_time/end_time are often mis-stored as "local-looking" UTC.
    const earlyMin = parseInt(process.env.PATIENT_JOIN_EARLY_MINUTES || '10', 10);
    const lateMin = parseInt(process.env.PATIENT_JOIN_LATE_MINUTES || '15', 10);
    const { startMs, endMs } = patientAppointmentJoinBoundsMs(appointment);
    const nowMs = Date.now();
    if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
      const earliest = startMs - Math.max(0, earlyMin) * 60 * 1000;
      const latest = endMs + Math.max(0, lateMin) * 60 * 1000;
      if (nowMs < earliest) {
        return res.status(403).json({
          success: false,
          error: `You can join up to ${earlyMin} minutes before your appointment start time.`
        });
      }
      if (nowMs > latest) {
        return res.status(403).json({
          success: false,
          error: 'This visit is no longer available to join.'
        });
      }
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
      room: resolvedRoom,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    });

    const token = await at.toJwt();
    const url = livekitUrl.startsWith('http') ? livekitUrl.replace(/^https?/, 'wss') : livekitUrl;
    if (livekitTokenDebugEnabled()) {
      console.log('[LiveKit] patient/video/token issued', {
        room: resolvedRoom,
        appointment_id: appointmentId,
        patient_id: sessionValidation.patient_id || null,
        journey_id: journeyId
      });
    }
    return res.json({ success: true, token, url, room: resolvedRoom });
  } catch (err) {
    console.error('[LiveKit] patient/video/token error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Failed to create token' });
  }
});
