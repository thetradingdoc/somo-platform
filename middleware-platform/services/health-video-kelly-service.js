'use strict';

const orchestrator = require('./kelly-pa-video-orchestrator');
const videoConsultService = require('./video-consult-service');
const healthSessionService = require('./health-session-service');
const videoConsultSse = require('./video-consult-sse');
const SafetyPreScreen = require('./safety-prescreen');
const { emergencyReply } = require('./kelly-pa-video-prompt');
const {
  buildTranscriptDeltaItem,
  buildAssistantUpdatePayload,
  buildAssistantMessagePayload,
  buildToolEventPayload
} = require('./video-consult-sse-schema');

const inFlight = new Map();

function buildHistory(roomId) {
  const arr = videoConsultService.getLiveTranscript(roomId) || [];
  return arr
    .filter((t) => t && (t.text || t.content))
    .slice(-12)
    .map((t) => ({
      role: t.speaker === 'assistant' ? 'assistant' : 'user',
      content: t.text || t.content || ''
    }));
}

function broadcastKellyReply(roomId, reply, extras = {}) {
  const deltaItem = buildTranscriptDeltaItem({
    ts: new Date().toISOString(),
    speaker: 'assistant',
    text: reply
  });
  videoConsultService.appendLiveTranscript(roomId, {
    text: reply,
    speaker: 'assistant',
    source: 'kelly_pa',
    timestamp: deltaItem.ts
  });
  videoConsultSse.broadcastTranscriptDelta(roomId, [deltaItem]);
  videoConsultSse.broadcastAssistantMessage(roomId, buildAssistantMessagePayload({ text: reply, status: 'complete' }));
  videoConsultSse.broadcastAssistantUpdate(
    roomId,
    buildAssistantUpdatePayload({
      transcript_delta: [deltaItem],
      clinical_insight: reply,
      status: extras.status || 'processing',
      risk: extras.risk || null
    })
  );
}

/**
 * Kelly PA reply for consumer health-* video rooms (patient speech only, is_final).
 */
async function maybeReplyToPatientTranscript(roomId, text, options = {}) {
  if (!healthSessionService.isHealthRoom(roomId)) return null;
  if (options.is_final === false) return null;

  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  const speaker = options.speaker || 'unknown';
  if (speaker !== 'patient' && speaker !== 'user') return null;

  if (inFlight.get(roomId)) return null;
  inFlight.set(roomId, true);

  try {
    const session = healthSessionService.getByRoom(roomId);
    const sessionId = healthSessionService.sessionIdFromRoom(roomId);

    healthSessionService.persistTranscript(sessionId, roomId, {
      speaker,
      text: trimmed,
      text_original: options.text_original || trimmed,
      text_translated: options.text_translated || null,
      source: options.source || 'stt',
      ts: options.timestamp || new Date().toISOString()
    });

    const safety = SafetyPreScreen.evaluateSafety({
      text: trimmed,
      eventType: 'transcript',
      payload: options,
      roomId
    });
    if (safety.emergency || safety.status === 'red') {
      const emergency = emergencyReply(session?.reply_language || 'en');
      broadcastKellyReply(roomId, emergency, {
        status: 'risk_alert',
        risk: { level: 'high', flags: safety.flags }
      });
      videoConsultSse.broadcastRiskAlert(roomId, { level: 'high', flags: safety.flags, message: emergency });
      if (sessionId) {
        healthSessionService.updateMetadata(sessionId, {
          safety_flags: safety.flags,
          last_emergency_at: new Date().toISOString()
        });
      }
      return { reply: emergency, meta: { safety: 'red' } };
    }

    videoConsultSse.broadcastAssistantMessage(roomId, buildAssistantMessagePayload({ text: '', status: 'thinking' }));

    const result = await orchestrator.processTurn({
      text: trimmed,
      history: buildHistory(roomId),
      session,
      roomId
    });

    const reply = result?.text?.trim();
    if (!reply) return null;

    broadcastKellyReply(roomId, reply, { risk: result.safety?.emergency ? { level: 'high' } : null });

    for (const te of result.toolEvents || []) {
      videoConsultSse.broadcastToolEvent(roomId, buildToolEventPayload(te));
      if (sessionId && te.name === 'request_body_region_capture') {
        const vision = (session?.metadata?.vision_artifacts || []).concat([te.result]);
        healthSessionService.updateMetadata(sessionId, { vision_artifacts: vision });
      }
    }

    if (sessionId && result.safety?.flags?.length) {
      healthSessionService.updateMetadata(sessionId, { safety_flags: result.safety.flags });
    }

    return { reply, meta: result.meta, toolEvents: result.toolEvents };
  } catch (e) {
    console.warn('[health-video-kelly] reply failed:', e.message);
    return null;
  } finally {
    inFlight.delete(roomId);
  }
}

module.exports = {
  maybeReplyToPatientTranscript
};
