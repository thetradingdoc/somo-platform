/**
 * CallSessionService
 *
 * Lightweight session lifecycle manager for voice/video calls.
 * Responsibilities:
 * - Create sessions on call start (bind callId, clinicId, prompt profile, traceId)
 * - Track per-call flags (degradedMode, handoff, etc.)
 * - Provide a simple in-memory cache with optional DB hooks
 * - Cleanup on call end
 *
 * NOTE: Per-call session state stays in-process (Retell WS is sticky to one instance).
 * Voice rate limits and concurrent call caps use Redis — never this Map.
 */

const logger = require('./logger');
const db = require('../database');
const { createTraceId } = require('../utils/tracing');
const DegradedModeService = require('./degraded-mode-service');

class CallSessionService {
  constructor() {
    /** @type {Map<string, any>} */
    this.sessions = new Map();
  }

  /**
   * Create or return an existing session for a call.
   * @param {Object} params
   * @param {string} params.callId
   * @param {string|null} [params.clinicId]
   * @param {Object} [params.metadata]
   */
  startSession(params) {
    const { callId, clinicId = null, metadata = {} } = params;
    if (!callId) {
      throw new Error('CallSessionService.startSession requires callId');
    }

    if (this.sessions.has(callId)) {
      const existing = this.sessions.get(callId);
      // Backfill clinicId if it becomes available later
      if (clinicId && !existing.clinicId) {
        existing.clinicId = clinicId;
      }
      return existing;
    }

    const traceId = createTraceId();

    const clinicPromptProfile = this._resolveClinicPromptProfile(clinicId);

    const session = {
      callId,
      clinicId,
      traceId,
      promptProfileId: clinicPromptProfile.id || 'default',
      promptVersion: clinicPromptProfile.version || 'v1',
      createdAt: new Date().toISOString(),
      degradedMode: false,
      handoffRequested: false,
      metadata: {
        ...metadata
      }
    };

    this.sessions.set(callId, session);

    try {
      if (db && typeof db.logCallSessionStart === 'function') {
        db.logCallSessionStart({
          call_id: callId,
          clinic_id: clinicId,
          trace_id: traceId,
          prompt_profile_id: session.promptProfileId,
          prompt_version: session.promptVersion
        });
      }
    } catch (e) {
      logger.warn('CallSessionService: failed to persist session start', {
        callId,
        error: e.message
      });
    }

    return session;
  }

  /**
   * Get a session by callId.
   * @param {string} callId
   */
  getSession(callId) {
    if (!callId) return null;
    return this.sessions.get(callId) || null;
  }

  /**
   * Update flags on a session (e.g., degradedMode, handoffRequested).
   * @param {string} callId
   * @param {Object} patch
   */
  updateSession(callId, patch) {
    const session = this.sessions.get(callId);
    if (!session) return null;
    Object.assign(session, patch);
    return session;
  }

  /**
   * End a session and optionally persist summary information.
   * @param {string} callId
   * @param {Object} [summary]
   */
  endSession(callId, summary = {}) {
    const session = this.sessions.get(callId);
    if (!session) return;

    this.sessions.delete(callId);

    try {
      DegradedModeService.clear(callId);
    } catch (_) { /* ignore */ }

    try {
      if (db && typeof db.logCallSessionEnd === 'function') {
        db.logCallSessionEnd({
          call_id: callId,
          clinic_id: session.clinicId,
          trace_id: session.traceId,
          degraded_mode: session.degradedMode ? 1 : 0,
          handoff_requested: session.handoffRequested ? 1 : 0,
          ...summary
        });
      }
    } catch (e) {
      logger.warn('CallSessionService: failed to persist session end', {
        callId,
        error: e.message
      });
    }
  }

  /**
   * Internal helper to resolve the default prompt profile for a clinic.
   * v1 is intentionally tolerant if the DB method is not yet implemented.
   */
  _resolveClinicPromptProfile(clinicId) {
    if (!clinicId || !db || !db.getClinicPromptProfile) {
      return {
        id: 'default',
        version: 'v1'
      };
    }
    try {
      const profile = db.getClinicPromptProfile(clinicId);
      if (!profile) {
        return {
          id: 'default',
          version: 'v1'
        };
      }
      return profile;
    } catch (e) {
      logger.warn('CallSessionService: failed to resolve clinic prompt profile', {
        clinicId,
        error: e.message
      });
      return {
        id: 'default',
        version: 'v1'
      };
    }
  }
}

module.exports = new CallSessionService();

