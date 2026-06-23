/**
 * ConversationStateService
 *
 * Lightweight conversation state tracking for voice/video sessions.
 * States are coarse-grained and intended as context for prompts and tools.
 */

const STATES = {
  GREETING: 'GREETING',
  INTAKE_REASON: 'INTAKE_REASON',
  COLLECT_INSURANCE: 'COLLECT_INSURANCE',
  SCHEDULING: 'SCHEDULING',
  CONFIRMATION: 'CONFIRMATION',
  OTHER: 'OTHER'
};

const DEFAULT_STATE = STATES.GREETING;

class ConversationStateService {
  constructor() {
    /** @type {Map<string, {state: string, updatedAt: string}>} */
    this.stateByCall = new Map();
  }

  getState(callId) {
    if (!callId) return DEFAULT_STATE;
    const entry = this.stateByCall.get(callId);
    return entry ? entry.state : DEFAULT_STATE;
  }

  setState(callId, state) {
    if (!callId) return;
    const nextState = STATES[state] || state || DEFAULT_STATE;
    this.stateByCall.set(callId, {
      state: nextState,
      updatedAt: new Date().toISOString()
    });
  }

  clear(callId) {
    if (!callId) return;
    this.stateByCall.delete(callId);
  }

  /**
   * Simple heuristic-based transition based on user utterance.
   * This is intentionally conservative and can be replaced with a learned policy later.
   */
  updateFromTranscript(callId, transcript) {
    if (!callId || !transcript) return this.getState(callId);
    const lower = transcript.toLowerCase();
    let current = this.getState(callId);

    if (current === DEFAULT_STATE) {
      current = STATES.INTAKE_REASON;
    }

    if (lower.includes('insurance') || lower.includes('coverage') || lower.includes('copay')) {
      current = STATES.COLLECT_INSURANCE;
    } else if (lower.includes('appointment') || lower.includes('schedule') || lower.includes('resched')) {
      current = STATES.SCHEDULING;
    } else if (lower.includes('confirm') || lower.includes('thanks') || lower.includes('that works')) {
      current = STATES.CONFIRMATION;
    }

    this.setState(callId, current);
    return current;
  }

  getStatesEnum() {
    return { ...STATES };
  }
}

module.exports = new ConversationStateService();

