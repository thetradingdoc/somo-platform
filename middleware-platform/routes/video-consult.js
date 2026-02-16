/**
 * Video Consult Routes
 * Receives events from LiveKit Python agents (transcript, vision_frame, end_session).
 * See docs/architecture/VIDEO_CONSULT_ENV.md for env vars.
 */

const express = require('express');
const router = express.Router();
const videoConsultService = require('../services/video-consult-service');
const videoConsultGraph = require('../services/video-consult-graph');
const tokenBudget = require('../utils/token-budget');

const RATE_LIMIT_PER_ROOM = 1000;
const rateLimitMap = new Map();
const AGENT_SECRET = process.env.VIDEO_CONSULT_AGENT_SECRET;
const BAA_ACKNOWLEDGED = process.env.BAA_ACKNOWLEDGED === 'true' || process.env.BAA_ACKNOWLEDGED === '1';

if (!BAA_ACKNOWLEDGED && process.env.NODE_ENV === 'production') {
  console.warn('⚠️  [video-consult] BAA_ACKNOWLEDGED not set. Ensure BHAs are in place with LiveKit, Deepgram/OpenAI before processing PHI.');
}

// vc-env-1: Validate LiveKit credentials at startup
function validateLiveKitEnv() {
  const url = process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret) {
    console.warn('⚠️  [video-consult] LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET not set. Video rooms will fail. See VIDEO_CONSULT_ENV.md');
    return false;
  }
  try {
    new URL(url);
    if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
      console.warn('⚠️  [video-consult] LIVEKIT_URL should be wss:// (e.g. wss://your-project.livekit.cloud)');
    }
  } catch (e) {
    console.warn('⚠️  [video-consult] LIVEKIT_URL invalid:', e.message);
    return false;
  }
  return true;
}
validateLiveKitEnv();

function verifyAgentAuth(req) {
  if (!AGENT_SECRET || !AGENT_SECRET.trim()) return true; // Dev: skip if not set
  const secret = req.headers['x-video-consult-secret'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  return secret === AGENT_SECRET;
}

function checkRateLimit(roomId) {
  const now = Date.now();
  const key = roomId;
  let bucket = rateLimitMap.get(key);
  if (!bucket) {
    bucket = { count: 0, resetAt: now + 60000 };
    rateLimitMap.set(key, bucket);
  }
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + 60000;
  }
  bucket.count++;
  return bucket.count <= RATE_LIMIT_PER_ROOM;
}

/**
 * POST /api/video-consult/agent-events
 * Body: { room, event, payload, encounter_id?, clinic_id?, patient_id?, provider_id? }
 */
router.post('/agent-events', async (req, res) => {
  try {
    if (!verifyAgentAuth(req)) {
      return res.status(401).json({ success: false, error: 'Unauthorized: invalid or missing agent secret' });
    }
    const { room, event, payload } = req.body;
    if (!room || !event) {
      return res.status(400).json({ success: false, error: 'Missing room or event' });
    }
    if (!['transcript', 'vision_frame', 'end_session'].includes(event)) {
      return res.status(400).json({ success: false, error: 'Invalid event type' });
    }

    if (!checkRateLimit(room)) {
      return res.status(429).json({ success: false, error: 'Rate limit exceeded' });
    }

    let options = {
      encounter_id: req.body.encounter_id,
      clinic_id: req.body.clinic_id,
      patient_id: req.body.patient_id,
      provider_id: req.body.provider_id,
      patientName: req.body.patient_name
    };

    const resolved = await videoConsultService.resolveRoomToEncounter(room);
    if (resolved) {
      options = { ...resolved, ...options };
    }

    if (event === 'transcript' || event === 'vision_frame') {
      let session = videoConsultService.getSession(room);
      if (!session) {
        session = videoConsultService.createSession(room, options);
      }
      options.session_metadata = { start_time: session.start_time || new Date().toISOString() };
      if (event === 'transcript') {
        videoConsultService.appendLiveTranscript(room, payload);
        if (payload?.participant_identity && payload?.speaker) {
          videoConsultService.trackParticipant(room, payload.participant_identity, payload.speaker === 'patient' ? 'patient' : 'provider');
        }
      }
      if (event === 'vision_frame') {
        if (payload?.participant_identity) {
          videoConsultService.trackParticipant(room, payload.participant_identity, payload.is_patient ? 'patient' : 'provider');
        }
        if (!videoConsultService.shouldProcessFrameForParticipant(room, payload)) {
          return res.json({ success: true, skipped: true, reason: 'non_patient_frame' });
        }
        if (!videoConsultService.canProcessFrame(room)) {
          return res.json({ success: true, skipped: true, reason: 'frame_limit' });
        }
        const frameCost = 0.01;
        if (!tokenBudget.canProceedVideoConsult(room, frameCost)) {
          return res.json({ success: true, skipped: true, reason: 'cost_limit' });
        }
        tokenBudget.addVideoConsultCost(room, frameCost);
      }
    }

    if (event === 'end_session') {
      const session = videoConsultService.getSession(room);
      options.session_metadata = { end_time: new Date().toISOString() };
      if (session?.start_time) {
        options.session_metadata.start_time = session.start_time;
        const durationMs = Date.now() - new Date(session.start_time).getTime();
        if (durationMs > 5 * 60 * 1000) {
          console.warn(`⚠️  [video-consult] Long session: room ${room} active ${Math.round(durationMs / 60000)}min (alert threshold: 5min)`);
        }
      }
    }
    if (event === 'end_session' && !tokenBudget.canProceedVideoConsult(room, 0.05)) {
      return res.json({ success: false, error: 'Cost limit exceeded', stage: 'BUDGET_EXCEEDED' });
    }

    const result = await videoConsultGraph.processEvent(room, event, payload || {}, options);

    if (event === 'end_session') {
      tokenBudget.resetVideoConsult(room);
      videoConsultService.clearLiveTranscript(room);
      videoConsultService.clearRoomParticipants(room);
      videoConsultService.endSession(room, {
        ...result,
        ended_at: new Date().toISOString()
      });
    }

    res.json({
      success: result.success !== false,
      stage: result.stage,
      requires_review: result.requires_review,
      skipped: result.skipped,
      reason: result.reason
    });
  } catch (err) {
    console.error('[video-consult] agent-events error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/video-consult/review-tasks
 * List HITL review tasks (optional ?room= or ?status=pending)
 */
router.get('/review-tasks', (req, res) => {
  try {
    const reviewTaskService = require('../services/review-task-service');
    const tasks = reviewTaskService.listTasks({
      room_id: req.query.room,
      status: req.query.status
    });
    res.json({ tasks });
  } catch (err) {
    console.error('[video-consult] review-tasks error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/video-consult/session/:roomId
 * Get session state (transcript, findings) for UI
 */
router.get('/session/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const state = await videoConsultService.getSessionState(roomId);
    res.json(state);
  } catch (err) {
    console.error('[video-consult] get session error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
