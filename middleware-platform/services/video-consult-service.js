/**
 * Video Consult Service
 * Manages multimodal telehealth sessions (LiveKit video + AI).
 * See docs/architecture for VIDEO_CONSULT_ARCHITECTURE.md
 */

const db = require('../database');

const MAX_FRAMES = parseInt(process.env.VIDEO_CONSULT_MAX_FRAMES_PER_SESSION || '90', 10);
const ENABLE_VISION = process.env.VIDEO_CONSULT_ENABLE_VISION === 'true' || process.env.VIDEO_CONSULT_ENABLE_VISION === '1';

const liveTranscripts = new Map();
const roomParticipants = new Map();
const roomRiskSeenRules = new Map(); // room_id -> Set of rule_id (idempotency)

/**
 * Append a live transcript event for a room.
 *
 * Normalizes different payload shapes from agents into a unified structure:
 * {
 *   text,          // string
 *   speaker,       // 'patient' | 'provider' | 'system' | 'unknown'
 *   timestamp,     // ISO string
 *   source,        // 'agent_stt' | 'chat' | 'note' | 'manual' | 'unknown'
 *   participant_identity, // LiveKit identity when available
 *   raw            // original payload for debugging
 * }
 */
function appendLiveTranscript(roomId, payload) {
  const arr = liveTranscripts.get(roomId) || [];
  const now = new Date().toISOString();
  const isString = typeof payload === 'string';
  const normalized = {
    text: isString ? payload : (payload?.text || payload?.content || ''),
    speaker: payload?.speaker || 'unknown',
    timestamp: payload?.timestamp || now,
    source: payload?.source || (payload?.event_source || 'agent_stt'),
    participant_identity: payload?.participant_identity || null,
    raw: isString ? undefined : payload
  };
  arr.push(normalized);
  liveTranscripts.set(roomId, arr);
  
  // Incremental persistence to database
  try {
    const db = require('../database');
    // Resolve appointment_id from room_id if it's appt-xxx format
    let appointmentId = payload?.appointment_id || null;
    if (!appointmentId && roomId && roomId.startsWith('appt-')) {
      const aptId = roomId.replace(/^appt-/, '');
      try {
        const apt = db.getAppointment(aptId);
        if (apt) appointmentId = apt.id;
      } catch (_) {}
    }
    db.insertVideoConsultTranscript(roomId, {
      appointment_id: appointmentId,
      participant_identity: normalized.participant_identity,
      speaker: normalized.speaker,
      text: normalized.text,
      timestamp: normalized.timestamp,
      source: normalized.source
    });
  } catch (e) {
    console.warn('⚠️  Failed to persist transcript incrementally:', e.message);
  }
  
  return arr;
}

function clearLiveTranscript(roomId) {
  liveTranscripts.delete(roomId);
}

/**
 * Track participant in room (P2 multi-participant).
 * @param {string} roomId
 * @param {string} participantIdentity - LiveKit participant identity
 * @param {string} [role] - 'patient' | 'provider' | 'unknown'
 */
function trackParticipant(roomId, participantIdentity, role = 'unknown') {
  if (!roomId || !participantIdentity) return;
  let set = roomParticipants.get(roomId);
  if (!set) {
    set = new Map(); // identity -> role
    roomParticipants.set(roomId, set);
  }
  set.set(participantIdentity, role);
}

/**
 * Check if frame from participant should be processed (P2: skip non-patient frames).
 * @param {string} roomId
 * @param {object} [framePayload] - { participant_identity?, is_patient? }
 * @returns {boolean} - true to process, false to skip
 */
function shouldProcessFrameForParticipant(roomId, framePayload) {
  const payload = typeof framePayload === 'string' ? { participant_identity: framePayload } : (framePayload || {});
  if (payload.is_patient === false) return false; // Explicitly non-patient
  if (!payload.participant_identity) return true; // No identity = process (backward compat)
  const participants = roomParticipants.get(roomId);
  if (!participants) return true; // No tracking = process
  const role = participants.get(payload.participant_identity);
  if (!role) return true; // Unknown participant = process
  return role === 'patient'; // Only process patient frames
}

function clearRoomParticipants(roomId) {
  roomParticipants.delete(roomId);
  roomRiskSeenRules.delete(roomId);
}

function getRiskSeenRules(roomId) {
  if (!roomRiskSeenRules.has(roomId)) roomRiskSeenRules.set(roomId, new Set());
  return roomRiskSeenRules.get(roomId);
}

function markRiskSeen(roomId, ruleIds) {
  const set = getRiskSeenRules(roomId);
  (ruleIds || []).forEach((id) => set.add(id));
}

/**
 * Resolve room_id (e.g. appt-xyz) to encounter, patient, provider
 * @param {string} roomId - LiveKit room name
 * @returns {Promise<{encounter_id, patient_id, provider_id, clinic_id}|null>}
 */
async function resolveRoomToEncounter(roomId) {
  if (!roomId || !roomId.startsWith('appt-')) return null;
  const appointmentId = roomId.replace(/^appt-/, '');
  try {
    const appointment = await db.getAppointment(appointmentId);
    if (!appointment) return null;
    return {
      encounter_id: appointment.encounter_id || appointment.id,
      patient_id: appointment.patient_id || appointment.customer_id,
      provider_id: appointment.provider_id || appointment.clinic_id,
      clinic_id: appointment.clinic_id
    };
  } catch (e) {
    console.warn('[video-consult] resolveRoomToEncounter failed:', e.message);
    return null;
  }
}

/**
 * Create or get video consult session
 */
function createSession(roomId, options = {}) {
  return db.createVideoConsultSession(roomId, options);
}

/**
 * Get session by room_id
 */
function getSession(roomId) {
  return db.getVideoConsultSession(roomId);
}

/**
 * End session and optionally attach metadata
 */
function endSession(roomId, metadata = null) {
  return db.endVideoConsultSession(roomId, metadata);
}

/**
 * Get session state for UI (transcript, findings, status)
 * @param {string} roomId
 * @returns {Promise<{session, transcript, findings, status}>}
 */
async function getSessionState(roomId) {
  let session = null;
  try {
    session = db.getVideoConsultSession(roomId);
  } catch (e) {
    if (!e.message?.includes('no such table')) console.warn('[video-consult] getSessionState:', e.message);
  }
  const meta = session?.metadata || {};
  const transcript = liveTranscripts.get(roomId) || meta.audio_transcript || [];
  const rag = meta.rag_context;
  const suggested_codes = rag
    ? { icd10: rag.icd10 || [], cpt: rag.cpt || [], hcpcs: rag.hcpcs || [] }
    : null;
  return {
    session: session || null,
    transcript,
    findings: meta.visual_findings || [],
    status: session?.session_status || 'unknown',
    ...(suggested_codes && { suggested_codes })
  };
}

/**
 * Check if vision processing is within frame limit
 */
function canProcessFrame(roomId) {
  const session = db.getVideoConsultSession(roomId);
  if (!session) return true;
  const meta = session.metadata || {};
  const frameCount = (meta.frame_count || 0) + (meta.video_frames?.length || 0);
  return ENABLE_VISION && frameCount < MAX_FRAMES;
}

/**
 * Log AI decision for audit
 */
function logAiDecision(roomId, stage, findings, codes, confidence, patientId, modelUsed) {
  return db.insertVideoConsultAiDecision(roomId, stage, findings, codes, confidence, patientId, modelUsed);
}

module.exports = {
  resolveRoomToEncounter,
  createSession,
  getSession,
  endSession,
  getSessionState,
  appendLiveTranscript,
  clearLiveTranscript,
  trackParticipant,
  shouldProcessFrameForParticipant,
  clearRoomParticipants,
  canProcessFrame,
  logAiDecision,
  getRiskSeenRules,
  markRiskSeen,
  ENABLE_VISION,
  MAX_FRAMES
};
