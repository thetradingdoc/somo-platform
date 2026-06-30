'use strict';

const videoConsultSse = require('../../video-consult-sse');
const healthSessionService = require('../session-service');
const healthSessionReport = require('../report-service');
const healthTurnService = require('../turn-service');
const healthVisionCaption = require('../vision-caption-bridge');
const tokenBudget = require('../../../utils/token-budget');
const {
  buildTranscriptDeltaItem,
  buildAssistantUpdatePayload
} = require('../../video-consult-sse-schema');

function requireHealthRoom(roomId, res) {
  if (!healthSessionService.isHealthRoom(roomId)) {
    res.status(400).json({ success: false, error: 'not_health_room' });
    return false;
  }
  return true;
}

async function handleAgentEvent(req, res) {
  const room = req.body.room || req.body.roomId;
  const event = req.body.event;
  const payload = req.body.payload || {};

  if (!room || !event) {
    return res.status(400).json({ success: false, error: 'room and event required' });
  }
  if (!requireHealthRoom(room, res)) return;

  if (event === 'transcript') {
    const text = payload?.text || payload?.content || '';
    const deltaItem = buildTranscriptDeltaItem({
      ts: payload?.timestamp || new Date().toISOString(),
      speaker: payload?.speaker || 'unknown',
      text,
      text_translated: payload.text_translated || null
    });
    videoConsultSse.broadcastTranscriptDelta(room, [deltaItem]);
    videoConsultSse.broadcastAssistantUpdate(room, buildAssistantUpdatePayload({ transcript_delta: [deltaItem], status: 'listening' }));
    if (
      healthTurnService.agentEventTurnIngressEnabled() &&
      (payload.speaker === 'patient' || payload.speaker === 'user')
    ) {
      setImmediate(() => {
        healthTurnService.processPatientTurn(room, text, {
          speaker: payload.speaker,
          is_final: payload?.is_final !== false,
          source: 'stt',
          timestamp: payload?.timestamp
        }).catch(() => {});
      });
    }
    return res.json({ success: true });
  }

  if (event === 'vision_frame') {
    const sessionId = healthSessionService.sessionIdFromRoom(room);
    if (sessionId && !tokenBudget.canProceedHealthSession(sessionId, { frames: 1 })) {
      return res.json({ success: true, skipped: true, reason: 'health_frame_limit' });
    }
    const yoloRaw = payload?.detections || payload?.yolo_detections || [];
    const captionResult = await healthVisionCaption.buildImageCaption({
      detections: yoloRaw,
      frameQuality: payload?.frame_quality || payload?.quality || 'fair',
      imageBase64: payload?.image_base64 || null
    });
    if (sessionId) {
      tokenBudget.addHealthSessionUsage(sessionId, { frames: 1 });
      const session = healthSessionService.getById(sessionId);
      const artifacts = (session?.metadata?.vision_artifacts || []).concat([{
        ts: new Date().toISOString(),
        caption: captionResult.caption,
        quality: captionResult.quality,
        tags: captionResult.tags || []
      }]);
      healthSessionService.updateMetadata(sessionId, { vision_artifacts: artifacts, last_vision_caption: captionResult.caption });
    }
    return res.json({ success: true, caption: captionResult });
  }

  if (event === 'end_session') {
    await healthSessionReport.finalizeSession(room);
    videoConsultSse.broadcastSessionEnded(room, { stage: 'health_session_ended' });
    try {
      const dbMod = require('../../../database');
      const sessionId = healthSessionService.sessionIdFromRoom(room);
      if (dbMod.logHipaaAccess && sessionId) {
        dbMod.logHipaaAccess({
          resource_type: 'health_session',
          resource_id: sessionId,
          action: 'session_end',
          ip_address: req.ip
        });
      }
    } catch (_) {}
    return res.json({ success: true, stage: 'health_session_ended' });
  }

  return res.json({ success: true, skipped: true, reason: 'unsupported_health_event' });
}

function handleSse(req, res) {
  const { roomId } = req.params;
  if (!roomId) return res.status(400).json({ error: 'Missing roomId' });
  if (!healthSessionService.isHealthRoom(roomId)) {
    return res.status(400).json({ error: 'not_health_room' });
  }
  const token = req.query.token || req.headers['x-health-sse-token'];
  if (!healthSessionService.verifySseToken(roomId, token)) {
    return res.status(401).json({ error: 'Invalid or expired SSE token' });
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('X-Somo-Transport', 'health-session');
  res.flushHeaders?.();
  videoConsultSse.register(roomId, res);
}

module.exports = {
  handleAgentEvent,
  handleSse
};
