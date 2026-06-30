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
const roomTranscriptTranslation = new Map(); // room_id -> { enabled, target_language }

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// Deep merge for JSON metadata blobs.
// - Objects: recurse
// - Arrays/primitives: source replaces target
function deepMerge(target, source) {
  if (!isPlainObject(target) || !isPlainObject(source)) return source;
  const out = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue;
    const prev = out[k];
    if (isPlainObject(prev) && isPlainObject(v)) out[k] = deepMerge(prev, v);
    else out[k] = v;
  }
  return out;
}

function mergeSessionMetadata(roomId, partialMetadata = {}) {
  if (!roomId) return null;
  const session = db.getVideoConsultSession(roomId);
  const existingMeta = session?.metadata || {};
  const incoming = partialMetadata || {};
  const merged = deepMerge(existingMeta, incoming);

  // Preserve any existing pre_visit unless caller explicitly provides it.
  if (existingMeta?.pre_visit && incoming?.pre_visit === undefined) {
    merged.pre_visit = existingMeta.pre_visit;
  }

  db.db?.prepare(`
    UPDATE video_consult_sessions
    SET metadata = ?, updated_at = datetime('now')
    WHERE room_id = ?
  `).run(JSON.stringify(merged), roomId);

  return db.getVideoConsultSession(roomId);
}

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
    text_translated: isString ? null : (payload?.text_translated || null),
    detected_language: isString ? null : (payload?.detected_language || null),
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
      text_translated: normalized.text_translated,
      detected_language: normalized.detected_language,
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
  roomTranscriptTranslation.delete(roomId);
}

function setTranscriptTranslationConfig(roomId, config = {}) {
  if (!roomId) return { enabled: false, target_language: 'en' };
  const normalized = {
    enabled: !!config.enabled,
    target_language: String(config.target_language || 'en').trim().toLowerCase() || 'en'
  };
  roomTranscriptTranslation.set(roomId, normalized);
  return normalized;
}

function getTranscriptTranslationConfig(roomId) {
  return roomTranscriptTranslation.get(roomId) || { enabled: false, target_language: 'en' };
}

async function maybeTranslateTranscriptText(text, roomId) {
  const cfg = getTranscriptTranslationConfig(roomId);
  const input = String(text || '').trim();
  if (!cfg.enabled || !input) {
    return { text_translated: null, detected_language: null, translated: false };
  }
  if (!process.env.OPENAI_API_KEY) {
    return { text_translated: null, detected_language: null, translated: false, reason: 'OPENAI_API_KEY_MISSING' };
  }
  try {
    const OpenAI = require('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const target = cfg.target_language || 'en';
    const comp = await openai.chat.completions.create({
      model: process.env.VIDEO_TRANSLATION_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Detect the source language and translate into ${target}. Return strict JSON: {"detected_language":"<iso-639-1>","translated_text":"<text>"}.`
        },
        { role: 'user', content: input }
      ],
      temperature: 0.1,
      max_tokens: 220
    });
    const raw = comp.choices?.[0]?.message?.content || '';
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    }
    const translated = String(parsed?.translated_text || '').trim();
    const detected = String(parsed?.detected_language || '').trim().toLowerCase() || null;
    if (!translated) {
      return { text_translated: null, detected_language: detected, translated: false };
    }
    return { text_translated: translated, detected_language: detected, translated: true };
  } catch (error) {
    console.warn('[video-consult] transcript translation failed:', error.message);
    return { text_translated: null, detected_language: null, translated: false, reason: error.message };
  }
}

function getRiskSeenRules(roomId) {
  if (!roomRiskSeenRules.has(roomId)) roomRiskSeenRules.set(roomId, new Set());
  return roomRiskSeenRules.get(roomId);
}

function markRiskSeen(roomId, ruleIds) {
  const set = getRiskSeenRules(roomId);
  (ruleIds || []).forEach((id) => set.add(id));
}

function appendShortTermThreadEvent(roomId, event = {}) {
  if (!roomId || !event) return null;
  const session = db.getVideoConsultSession(roomId);
  const meta = session?.metadata || {};
  const current = Array.isArray(meta.short_term_thread) ? meta.short_term_thread : [];
  const normalized = {
    type: String(event.type || 'note').trim() || 'note',
    text: String(event.text || '').trim(),
    file_name: event.file_name ? String(event.file_name).trim() : null,
    mime_type: event.mime_type ? String(event.mime_type).trim() : null,
    created_at: event.created_at || new Date().toISOString(),
    actor: String(event.actor || 'user').trim() || 'user'
  };
  const next = [...current, normalized].slice(-60);
  return mergeSessionMetadata(roomId, { short_term_thread: next });
}

/**
 * Resolve room_id (e.g. appt-xyz) to encounter, patient, provider
 * @param {string} roomId - LiveKit room name
 * @returns {Promise<{encounter_id, patient_id, provider_id, clinic_id}|null>}
 */
async function resolveRoomToEncounter(roomId) {
  if (roomId && roomId.startsWith('health-')) {
    const healthSessionService = require('./health-session-service');
    const session = healthSessionService.getByRoom(roomId);
    if (session) {
      return {
        encounter_id: session.id,
        patient_id: null,
        provider_id: null,
        clinic_id: null,
        session_type: 'health_video'
      };
    }
  }
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
  try {
    const existing = db.getVideoConsultSession(roomId);
    const existingMeta = existing?.metadata || {};
    const incoming = metadata || null;

    if (incoming && typeof incoming === 'object') {
      const merged = deepMerge(existingMeta, incoming);

      // If pipeline didn't include pre_visit, keep it.
      if (existingMeta?.pre_visit && merged?.pre_visit === undefined) {
        merged.pre_visit = existingMeta.pre_visit;
      }

      return db.endVideoConsultSession(roomId, merged);
    }
  } catch (_) {
    // fall back to non-merge
  }

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

function getLiveTranscript(roomId) {
  return liveTranscripts.get(roomId) || [];
}

module.exports = {
  resolveRoomToEncounter,
  createSession,
  getSession,
  endSession,
  mergeSessionMetadata,
  getSessionState,
  appendLiveTranscript,
  getLiveTranscript,
  clearLiveTranscript,
  setTranscriptTranslationConfig,
  getTranscriptTranslationConfig,
  maybeTranslateTranscriptText,
  trackParticipant,
  shouldProcessFrameForParticipant,
  clearRoomParticipants,
  canProcessFrame,
  logAiDecision,
  getRiskSeenRules,
  markRiskSeen,
  appendShortTermThreadEvent,
  ENABLE_VISION,
  MAX_FRAMES
};
