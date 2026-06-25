'use strict';

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const healthSessionService = require('../services/health-session-service');
const healthSessionReport = require('../services/health-session-report-service');
const healthVideoKelly = require('../services/health-video-kelly-service');
const videoConsultService = require('../services/video-consult-service');

const healthSessionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests' }
});

router.use(healthSessionLimiter);

let AccessToken;
try {
  const livekit = require('livekit-server-sdk');
  AccessToken = livekit.AccessToken;
} catch (_) {}

async function mintLiveKitToken(room, identity, name) {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl = process.env.LIVEKIT_URL;
  if (!AccessToken || !apiKey || !apiSecret || !livekitUrl) {
    const err = new Error('LiveKit not configured');
    err.statusCode = 503;
    throw err;
  }
  const at = new AccessToken(apiKey, apiSecret, { identity, name, ttl: '2h' });
  at.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true
  });
  const token = await at.toJwt();
  const url = livekitUrl.startsWith('http') ? livekitUrl.replace(/^https?/, 'wss') : livekitUrl;
  return { token, url, room };
}

function requireSessionToken(req, res, sessionId) {
  const token = req.headers['x-health-session-token'] || req.body?.session_token || req.query.session_token;
  if (!healthSessionService.verifySessionToken(sessionId, token)) {
    res.status(401).json({ success: false, error: 'Invalid session token' });
    return false;
  }
  return true;
}

function logHipaaAccess(req, sessionId, action) {
  try {
    const db = require('../database');
    if (db.logHipaaAccess) {
      db.logHipaaAccess({
        resource_type: 'health_session',
        resource_id: sessionId,
        action,
        ip_address: req.ip
      });
    }
  } catch (_) {}
}

/**
 * POST /api/health-session/start
 */
router.post('/start', express.json(), async (req, res) => {
  try {
    if (!req.body?.terms_accepted) {
      return res.status(400).json({ success: false, error: 'terms_accepted is required' });
    }
    const session = healthSessionService.createSession({
      locale: req.body.locale || 'en',
      replyLanguage: req.body.reply_language || req.body.locale || 'en',
      termsAccepted: true,
      termsVersion: req.body.terms_version || healthSessionService.TERMS_VERSION,
      displayName: req.body.display_name || null,
      metadata: req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {}
    });
    videoConsultService.createSession(session.room_id, {
      encounter_id: session.id,
      session_type: 'health_video'
    });
    const identity = `patient-${uuidv4().slice(0, 8)}`;
    const livekit = await mintLiveKitToken(session.room_id, identity, req.body.display_name || 'Patient');
    res.json({
      success: true,
      session: healthSessionService.toPublicSession(session),
      session_token: session.session_token,
      sse_token: session.sse_token,
      livekit: { ...livekit, identity },
      sse_url: `/api/video-consult/sse/${encodeURIComponent(session.room_id)}?token=${encodeURIComponent(session.sse_token)}`,
      terms_version: session.terms_version
    });
  } catch (e) {
    const status = e.statusCode || 500;
    res.status(status).json({ success: false, error: e.message });
  }
});

router.get('/:id', (req, res) => {
  const session = healthSessionService.getById(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
  res.json({ success: true, session: healthSessionService.toPublicSession(session) });
});

router.post('/:id/token', express.json(), async (req, res) => {
  const session = healthSessionService.getById(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
  if (!requireSessionToken(req, res, req.params.id)) return;
  try {
    const identity = `patient-${uuidv4().slice(0, 8)}`;
    const livekit = await mintLiveKitToken(session.room_id, identity, req.body?.display_name || 'Patient');
  const refreshed = healthSessionService.refreshSseToken(req.params.id);
    res.json({
      success: true,
      livekit: { ...livekit, identity },
      sse_token: refreshed.sse_token,
      sse_url: `/api/video-consult/sse/${encodeURIComponent(session.room_id)}?token=${encodeURIComponent(refreshed.sse_token)}`
    });
  } catch (e) {
    res.status(e.statusCode || 500).json({ success: false, error: e.message });
  }
});

router.get('/:id/report', async (req, res) => {
  const session = healthSessionService.getById(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
  if (!requireSessionToken(req, res, req.params.id)) return;
  logHipaaAccess(req, req.params.id, 'report_read');
  res.json({ success: true, report: session.report });
});

router.get('/:id/transcript', (req, res) => {
  const session = healthSessionService.getById(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
  if (!requireSessionToken(req, res, req.params.id)) return;
  logHipaaAccess(req, req.params.id, 'transcript_read');
  const lines = healthSessionService.listTranscripts(req.params.id);
  res.json({ success: true, transcript: lines });
});

router.post('/:id/turn', express.json(), async (req, res) => {
  const session = healthSessionService.getById(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ success: false, error: 'text is required' });
  const result = await healthVideoKelly.maybeReplyToPatientTranscript(session.room_id, text, {
    speaker: 'patient',
    is_final: true,
    source: 'dev_turn'
  });
  res.json({ success: true, result });
});

router.post('/:id/end', express.json(), async (req, res) => {
  try {
    const session = healthSessionService.getById(req.params.id);
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
    if (!requireSessionToken(req, res, req.params.id)) return;
    const ended = await healthSessionReport.finalizeSession(session.room_id);
    videoConsultService.endSession(session.room_id, { ended_at: new Date().toISOString(), health_report: ended?.report });
    logHipaaAccess(req, req.params.id, 'session_end');
    res.json({ success: true, session: healthSessionService.toPublicSession(ended) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
