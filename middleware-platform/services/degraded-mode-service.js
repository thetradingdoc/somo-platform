/**
 * DegradedModeService
 *
 * Tracks repeated failures for a call and signals when to enter degraded mode.
 */

const CallSessionService = require('./call-session-service');

const MAX_ERRORS_BEFORE_DEGRADED = 3;

class DegradedModeService {
  constructor() {
    /** @type {Map<string, number>} */
    this.errorCounts = new Map();
  }

  recordError(callId) {
    if (!callId) return;
    const next = (this.errorCounts.get(callId) || 0) + 1;
    this.errorCounts.set(callId, next);
    if (next >= MAX_ERRORS_BEFORE_DEGRADED) {
      CallSessionService.updateSession(callId, { degradedMode: true });
    }
  }

  clear(callId) {
    if (!callId) return;
    this.errorCounts.delete(callId);
  }
}

module.exports = new DegradedModeService();

