/**
 * Video Consult Routes
 * Receives events from LiveKit Python agents (transcript, vision_frame, end_session).
 * See docs/architecture/VIDEO_CONSULT_ENV.md for env vars.
 */

const express = require('express');
const router = express.Router();
const videoConsultService = require('../services/video-consult-service');
const videoConsultGraph = require('../services/video-consult-graph');
const videoConsultAssistant = require('../services/video-consult-assistant-service');
const { mapYoloToClinical } = videoConsultAssistant;
const videoConsultSse = require('../services/video-consult-sse');
const symptomTriage = require('../services/symptom-triage-service');
const { buildTranscriptDeltaItem, buildAssistantUpdatePayload } = require('../services/video-consult-sse-schema');
const knowledgeService = require('../services/knowledge-service');
const tokenBudget = require('../utils/token-budget');

const RATE_LIMIT_PER_ROOM = 1000;
const rateLimitMap = new Map();

// Real-time code hints: debounced RAG fetch on transcript
const REALTIME_CODES_DEBOUNCE_MS = 12000;
const REALTIME_CODES_MIN_TRANSCRIPTS = 3;
const realtimeCodeTimers = new Map();

async function fetchAndBroadcastRealtimeCodes(roomId) {
  realtimeCodeTimers.delete(roomId);
  try {
    const state = await videoConsultService.getSessionState(roomId);
    const transcript = state.transcript || [];
    const text = transcript.map(t => (typeof t === 'string' ? t : t.text || t.content || '')).filter(Boolean).join(' ').slice(0, 2000);
    if (!text.trim() || text.length < 50) return;
    const dual = await knowledgeService.getCodeCandidatesDualSource(text, {
      maxIcd10: 10,
      maxCpt: 8,
      maxHcpcs: 5
    });
    videoConsultSse.broadcastCodesUpdated(roomId, {
      codes: { icd10: dual.icd10 || [], cpt: dual.cpt || [], hcpcs: dual.hcpcs || [] },
      status: 'codes_updated'
    });
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.warn('[video-consult] realtime codes fetch failed:', e.message);
  }
}

function scheduleRealtimeCodeFetch(roomId, transcriptLength) {
  if (transcriptLength < REALTIME_CODES_MIN_TRANSCRIPTS) return;
  const existing = realtimeCodeTimers.get(roomId);
  if (existing) clearTimeout(existing);
  realtimeCodeTimers.set(
    roomId,
    setTimeout(() => fetchAndBroadcastRealtimeCodes(roomId), REALTIME_CODES_DEBOUNCE_MS)
  );
}
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

    // Lightweight debug log in non-production for observability
    if (process.env.NODE_ENV !== 'production') {
      const preview =
        event === 'transcript'
          ? (payload?.text || payload?.content || '').slice(0, 80)
          : (payload?.tags || payload?.label || '').toString().slice(0, 80);
      console.log(
        `[video-consult] agent-event room=${room} event=${event} speaker=${payload?.speaker || 'n/a'} preview="${preview}"`
      );
    }

    if (event === 'transcript' || event === 'vision_frame') {
      let session = videoConsultService.getSession(room);
      if (!session) {
        session = videoConsultService.createSession(room, options);
      }
      options.session_metadata = { start_time: session.start_time || new Date().toISOString() };
      if (event === 'transcript') {
        const transcriptArr = videoConsultService.appendLiveTranscript(room, payload);
        if (payload?.participant_identity && payload?.speaker) {
          videoConsultService.trackParticipant(room, payload.participant_identity, payload.speaker === 'patient' ? 'patient' : 'provider');
        }
        const text = payload?.text || payload?.content || '';
        const deltaItem = buildTranscriptDeltaItem({
          ts: payload?.timestamp || new Date().toISOString(),
          speaker: payload?.speaker || 'unknown',
          text
        });
        videoConsultSse.broadcastTranscriptDelta(room, [deltaItem]);
        videoConsultSse.broadcastAssistantUpdate(room, buildAssistantUpdatePayload({ transcript_delta: [deltaItem], status: 'listening' }));
        scheduleRealtimeCodeFetch(room, transcriptArr?.length || 0);
        const seenRules = videoConsultService.getRiskSeenRules(room);
        const riskResult = symptomTriage.detectRisk(text, room, seenRules);
        if (riskResult) {
          videoConsultService.markRiskSeen(room, riskResult.rule_ids);
          videoConsultSse.broadcastRiskAlert(room, riskResult);
          videoConsultSse.broadcastAssistantUpdate(room, buildAssistantUpdatePayload({ risk: riskResult, status: 'listening' }));
          try {
            const db = require('../database');
            let appointmentId = options.appointment_id || null;
            if (!appointmentId && room.startsWith('appt-')) appointmentId = room.replace(/^appt-/, '');
            (riskResult.flags || []).forEach((f) => {
              db.insertVideoConsultRiskEvent(room, {
                appointment_id: appointmentId,
                patient_id: options.patient_id,
                provider_id: options.provider_id,
                rule_id: f.rule_id,
                level: f.level,
                match_snippet: f.match_snippet
              });
            });
          } catch (e) { console.warn('[video-consult] risk event persist failed:', e.message); }
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
        
        // Incremental frame persistence
        try {
          const db = require('../database');
          let appointmentId = options.appointment_id || null;
          if (!appointmentId && room && room.startsWith('appt-')) {
            const aptId = room.replace(/^appt-/, '');
            try {
              const apt = db.getAppointment(aptId);
              if (apt) appointmentId = apt.id;
            } catch (_) {}
          }
          db.insertVideoConsultFrame(room, {
            appointment_id: appointmentId,
            participant_identity: payload?.participant_identity || null,
            frame_url: payload?.frame_url || payload?.url || null,
            yolo_detections: payload?.detections || payload?.yolo_detections || null,
            timestamp: payload?.timestamp || new Date().toISOString()
          });
          const yoloRaw = payload?.detections || payload?.yolo_detections || [];
          const yoloFindings = Array.isArray(yoloRaw)
            ? yoloRaw.map((d) => {
                const cls = d.class || d.name || 'unknown';
                const conf = d.confidence || d.conf || 0;
                const mapped = mapYoloToClinical(cls, conf);
                return { finding: mapped.finding, confidence: conf, raw_class: cls };
              })
            : [];
          videoConsultSse.broadcastAssistantUpdate(room, buildAssistantUpdatePayload({ yolo_findings: yoloFindings.slice(0, 5), status: 'processing' }));
        } catch (e) {
          console.warn('⚠️  Failed to persist frame incrementally:', e.message);
        }
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

    // §7 Idempotency: if session already ended, return last result without re-running pipeline
    if (event === 'end_session') {
      const existingSession = videoConsultService.getSession(room);
      if (existingSession?.session_status === 'ended' && existingSession?.metadata) {
        const meta = existingSession.metadata;
        let suggested_codes = undefined;
        let invalid_codes = meta.invalid_codes;
        if (meta.rag_context?.icd10?.length || meta.rag_context?.cpt?.length || meta.rag_context?.hcpcs?.length) {
          suggested_codes = {
            icd10: meta.rag_context.icd10 || [],
            cpt: meta.rag_context.cpt || [],
            hcpcs: meta.rag_context.hcpcs || []
          };
        }
        return res.json({
          success: true,
          stage: meta.stage || 'ended',
          requires_review: meta.requires_review || false,
          skipped: true,
          reason: 'idempotent_repeat_end',
          ...(suggested_codes && { suggested_codes }),
          ...(invalid_codes && { invalid_codes })
        });
      }
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
      videoConsultSse.broadcastSessionEnded(room, { stage: result.stage });
      // Audit: persist suggested codes from RAG + local merge (validated)
      if (result.rag_context?.merged_codes) {
        try {
          const merged = result.rag_context.merged_codes;
          const codeStrings = {
            icd10: (merged.icd10 || []).map((c) => c?.code).filter(Boolean),
            cpt: (merged.cpt || []).map((c) => c?.code).filter(Boolean),
            hcpcs: (merged.hcpcs || []).map((c) => c?.code).filter(Boolean)
          };
          const validation = knowledgeService.validateCodesExist(codeStrings, { trustExternalSource: true });
          const validIcd10 = (merged.icd10 || []).filter((c) => c?.code && !validation.invalid.icd10.includes(String(c.code).trim()));
          const validCpt = (merged.cpt || []).filter((c) => c?.code && !validation.invalid.cpt.includes(String(c.code).trim()));
          const validHcpcs = (merged.hcpcs || []).filter((c) => c?.code && !validation.invalid.hcpcs.includes(String(c.code).trim()));
          const toLog = { icd10: validIcd10, cpt: validCpt, hcpcs: validHcpcs };
          const codeCount = validIcd10.length + validCpt.length + validHcpcs.length;
          videoConsultService.logAiDecision(
            room,
            result.stage || 'RAG_COMPLETE',
            { transcript_length: (result.rag_context?.query || '').length, code_count: codeCount, invalid_filtered: !validation.valid },
            toLog,
            codeCount > 0 ? 0.85 : 0,
            options.patient_id || null,
            'video_consult_rag'
          );
        } catch (e) {
          console.warn('[video-consult] logAiDecision failed:', e.message);
        }
      }
    }

    // Validate suggested codes before exposing (filter invalid; trust RAG format when valid)
    let suggested_codes = undefined;
    let invalid_codes = undefined;
    if (result.rag_context) {
      const raw = {
        icd10: result.rag_context.icd10 || [],
        cpt: result.rag_context.cpt || [],
        hcpcs: result.rag_context.hcpcs || []
      };
      const codeStrings = {
        icd10: raw.icd10.map((c) => c?.code).filter(Boolean),
        cpt: raw.cpt.map((c) => c?.code).filter(Boolean),
        hcpcs: raw.hcpcs.map((c) => c?.code).filter(Boolean)
      };
      const validation = knowledgeService.validateCodesExist(codeStrings, { trustExternalSource: true });
      suggested_codes = {
        icd10: raw.icd10.filter((c) => c?.code && !validation.invalid.icd10.includes(String(c.code).trim())),
        cpt: raw.cpt.filter((c) => c?.code && !validation.invalid.cpt.includes(String(c.code).trim())),
        hcpcs: raw.hcpcs.filter((c) => c?.code && !validation.invalid.hcpcs.includes(String(c.code).trim()))
      };
      if (validation.invalid.icd10.length || validation.invalid.cpt.length || validation.invalid.hcpcs.length) {
        invalid_codes = validation.invalid;
      }
      if (suggested_codes && (event === 'end_session')) {
        videoConsultSse.broadcastCodesUpdated(room, suggested_codes);
      }
    }

    res.json({
      success: result.success !== false,
      stage: result.stage,
      requires_review: result.requires_review,
      skipped: result.skipped,
      reason: result.reason,
      ...(suggested_codes && { suggested_codes }),
      ...(invalid_codes && { invalid_codes })
    });
  } catch (err) {
    console.error('[video-consult] agent-events error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/video-consult/sse/:roomId
 * Server-Sent Events stream for real-time HUD updates.
 * Credentials sent via cookie for same-origin; validate room access.
 */
router.get('/sse/:roomId', (req, res) => {
  const { roomId } = req.params;
  if (!roomId) return res.status(400).json({ error: 'Missing roomId' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  videoConsultSse.register(roomId, res);
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

/**
 * GET /api/video-consult/assistant/:roomId
 * Get assistant overlay view (summary + suggestions) for provider UI.
 */
router.get('/assistant/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    if (!roomId) {
      return res.status(400).json({ success: false, error: 'Missing roomId' });
    }
    const view = await videoConsultAssistant.getAssistantView(roomId);
    res.json({ success: true, view });
  } catch (err) {
    console.error('[video-consult] assistant view error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
