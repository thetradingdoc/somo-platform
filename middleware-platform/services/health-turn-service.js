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

const MAX_QUEUE = 8;
const roomQueues = new Map();

function buildHistoryFromDb(sessionId) {
  const rows = healthSessionService.listTranscripts(sessionId) || [];
  return rows
    .filter((r) => r && r.text)
    .slice(-12)
    .map((r) => ({
      role: r.speaker === 'assistant' ? 'assistant' : 'user',
      content: r.text
    }));
}

function appendLiveLine(roomId, item) {
  videoConsultService.appendLiveTranscript(roomId, {
    text: item.text,
    speaker: item.speaker,
    source: item.source || 'turn',
    timestamp: item.ts || new Date().toISOString()
  });
}

function persistLine(sessionId, roomId, item) {
  healthSessionService.persistTranscript(sessionId, roomId, item);
  appendLiveLine(roomId, item);
}

function broadcastKellyReply(roomId, reply, extras = {}) {
  const deltaItem = buildTranscriptDeltaItem({
    ts: new Date().toISOString(),
    speaker: 'assistant',
    text: reply
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

async function processOneTurn(roomId, text, options = {}) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return { success: false, error: 'empty_text', code: 'EMPTY_TEXT' };
  }

  const session = healthSessionService.getByRoom(roomId);
  const sessionId = healthSessionService.sessionIdFromRoom(roomId);
  if (!sessionId || !session) {
    return { success: false, error: 'session_not_found', code: 'SESSION_NOT_FOUND' };
  }

  const speaker = options.speaker || 'patient';
  const ts = options.timestamp || new Date().toISOString();

  persistLine(sessionId, roomId, {
    speaker,
    text: trimmed,
    text_original: options.text_original || trimmed,
    text_translated: options.text_translated || null,
    source: options.source || 'turn',
    ts
  });

  const safety = SafetyPreScreen.evaluateSafety({
    text: trimmed,
    eventType: 'transcript',
    payload: options,
    roomId
  });

  if (safety.emergency || safety.status === 'red') {
    const emergency = emergencyReply(session.reply_language || 'en');
    persistLine(sessionId, roomId, {
      speaker: 'assistant',
      text: emergency,
      source: 'kelly_pa',
      ts: new Date().toISOString()
    });
    broadcastKellyReply(roomId, emergency, {
      status: 'risk_alert',
      risk: { level: 'high', flags: safety.flags }
    });
    videoConsultSse.broadcastRiskAlert(roomId, { level: 'high', flags: safety.flags, message: emergency });
    healthSessionService.updateMetadata(sessionId, {
      safety_flags: safety.flags,
      last_emergency_at: new Date().toISOString()
    });
    return { success: true, reply: emergency, meta: { safety: 'red' } };
  }

  videoConsultSse.broadcastAssistantMessage(roomId, buildAssistantMessagePayload({ text: '', status: 'thinking' }));

  const freshSession = healthSessionService.getById(sessionId);
  const result = await orchestrator.processTurn({
    text: trimmed,
    history: buildHistoryFromDb(sessionId),
    session: freshSession,
    roomId
  });

  const reply = result?.text?.trim();
  if (!reply) {
    return { success: false, error: 'Kelly did not return a reply', code: 'EMPTY_REPLY' };
  }

  persistLine(sessionId, roomId, {
    speaker: 'assistant',
    text: reply,
    source: 'kelly_pa',
    ts: new Date().toISOString()
  });
  broadcastKellyReply(roomId, reply, { risk: result.safety?.emergency ? { level: 'high' } : null });

  for (const te of result.toolEvents || []) {
    videoConsultSse.broadcastToolEvent(roomId, buildToolEventPayload(te));
    if (te.name === 'request_body_region_capture') {
      const vision = (freshSession?.metadata?.vision_artifacts || []).concat([te.result]);
      healthSessionService.updateMetadata(sessionId, { vision_artifacts: vision });
    }
  }

  if (result.safety?.flags?.length) {
    healthSessionService.updateMetadata(sessionId, { safety_flags: result.safety.flags });
  }

  const skinTool = (result.toolEvents || []).find((t) => t.name === 'analyze_skin_concern');
  if (skinTool?.result?.citations?.length) {
    healthSessionService.updateMetadata(sessionId, { last_citations: skinTool.result.citations });
  }

  return { success: true, reply, meta: result.meta, toolEvents: result.toolEvents };
}

function getQueue(roomId) {
  if (!roomQueues.has(roomId)) {
    roomQueues.set(roomId, { processing: false, pending: [] });
  }
  return roomQueues.get(roomId);
}

async function drainQueue(roomId) {
  const q = getQueue(roomId);
  if (q.processing) return;
  q.processing = true;
  let lastResult = null;
  let lastError = null;

  try {
    while (q.pending.length) {
      const batch = q.pending.splice(0);
      const mergedText = batch.map((b) => b.text).join(' ').trim();
      const opts = { ...batch[batch.length - 1].options, coalesced: batch.length > 1 };
      try {
        lastResult = await processOneTurn(roomId, mergedText, opts);
        if (!lastResult.success) lastError = lastResult;
      } catch (e) {
        lastError = { success: false, error: e.message, code: 'TURN_FAILED' };
        console.warn('[health-turn-service] turn failed:', e.message);
      }
    }
  } finally {
    q.processing = false;
    if (q.pending.length) {
      setImmediate(() => drainQueue(roomId));
    }
  }

  if (lastError && !lastResult?.success) return lastError;
  return lastResult;
}

/**
 * Queue a patient turn; coalesces rapid finals while a turn is in flight.
 */
async function processPatientTurn(roomId, text, options = {}) {
  if (!healthSessionService.isHealthRoom(roomId)) {
    return { success: false, error: 'not_health_room', code: 'NOT_HEALTH_ROOM' };
  }
  if (options.is_final === false) {
    return { success: false, error: 'interim_transcript', code: 'INTERIM' };
  }

  const speaker = options.speaker || 'unknown';
  if (speaker !== 'patient' && speaker !== 'user') {
    return { success: false, error: 'invalid_speaker', code: 'INVALID_SPEAKER' };
  }

  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return { success: false, error: 'empty_text', code: 'EMPTY_TEXT' };
  }

  const q = getQueue(roomId);
  if (q.pending.length >= MAX_QUEUE) {
    return { success: false, error: 'Too many pending messages. Please wait.', code: 'QUEUE_FULL' };
  }

  q.pending.push({ text: trimmed, options });
  return drainQueue(roomId);
}

function resetQueue(roomId) {
  roomQueues.delete(roomId);
}

module.exports = {
  processPatientTurn,
  processOneTurn,
  buildHistoryFromDb,
  resetQueue
};
