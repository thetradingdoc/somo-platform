/**
 * UnifiedEncounterRequest — Shared request shape for Retell (voice) and Triage-UI (chat).
 * Single entry point for PatientOrchestratorService.orchestrate().
 *
 * @typedef {Object} UnifiedEncounterRequest
 * @property {'voice'|'chat'} channel
 * @property {string} transcript_or_message - User's message (speech transcript or typed text)
 * @property {string} [session_id]
 * @property {string} [patient_id]
 * @property {string} [caller_phone] - For voice; enables resume on callback
 * @property {string} [portal_session_id]
 * @property {string} [clinic_id]
 * @property {string} [patient_email]
 * @property {Object} [meta] - Chip actions, slot selection, etc. { action?, slot?, ... }
 * @property {string} [last_message_id] - For idempotency / barge-in cancellation
 * @property {number} [sequence_number]
 */

/**
 * ResponseObject — Channel-agnostic response; adapters translate to UI (chips) or TTS (speech).
 *
 * @typedef {Object} ResponseObject
 * @property {string} reply - Main text to display or speak
 * @property {string} session_id
 * @property {Object} state - { current_state, ...flow_state }
 * @property {Array<{label:string,value:string,action?:string,slot?:Object}>} [next_chips]
 * @property {string} [redirect_to]
 * @property {string} [next_step] - e.g. UPLOAD_IMAGE
 * @property {Object} [response_constraints] - { max_words?, format? } for channel tuning (voice: ~20 words; chat: detailed)
 * @property {string} [text] - Alias for reply (voice adapter)
 */

/**
 * Normalize incoming request from Retell or Triage-UI into UnifiedEncounterRequest.
 *
 * @param {Object} raw - Raw body from API or Retell handler
 * @param {'voice'|'chat'} channel
 * @param {Object} [ctx] - { patient_id, caller_phone, clinic_id, portal_session_id, patient_email }
 * @returns {UnifiedEncounterRequest}
 */
function toUnifiedEncounterRequest(raw, channel, ctx = {}) {
  const message = (raw?.transcript_or_message ?? raw?.message ?? raw?.transcript ?? '').toString().trim();
  return {
    channel,
    transcript_or_message: message,
    session_id: raw?.session_id ?? raw?.state?.session_id ?? ctx?.session_id,
    patient_id: ctx?.patient_id ?? raw?.patient_id,
    caller_phone: ctx?.caller_phone ?? raw?.caller_phone,
    portal_session_id: ctx?.portal_session_id ?? raw?.portal_session_id,
    clinic_id: ctx?.clinic_id ?? raw?.clinic_id,
    patient_email: ctx?.patient_email ?? raw?.patient_email,
    meta: raw?.meta ?? {},
    last_message_id: raw?.last_message_id,
    sequence_number: typeof raw?.sequence_number === 'number' ? raw.sequence_number : undefined
  };
}

/**
 * Validate UnifiedEncounterRequest has required fields.
 *
 * @param {UnifiedEncounterRequest} req
 * @returns {{ valid: boolean, error?: string }}
 */
function validateUnifiedEncounterRequest(req) {
  if (!req || typeof req !== 'object') {
    return { valid: false, error: 'Request must be an object' };
  }
  if (!['voice', 'chat'].includes(req.channel)) {
    return { valid: false, error: 'channel must be "voice" or "chat"' };
  }
  if (typeof req.transcript_or_message !== 'string') {
    return { valid: false, error: 'transcript_or_message must be a string' };
  }
  return { valid: true };
}

module.exports = {
  toUnifiedEncounterRequest,
  validateUnifiedEncounterRequest
};
