'use strict';

const Metrics = require('./metrics');

/** @typedef {'pending'|'complete'|'fallback'|'disabled'|'unknown'} ReasoningFsmState */

const FALLBACK_REASON = Object.freeze({
  NONE: 'none',
  DETERMINISTIC_FALLBACK: 'deterministic_fallback',
  PROVIDER_ERROR: 'provider_error',
  SCHEMA_INVALID: 'schema_invalid',
  GATE_OR_CONFIDENCE: 'gate_or_confidence'
});

function normalizeState(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'pending' || s === 'complete' || s === 'fallback' || s === 'disabled') return s;
  return 'unknown';
}

/**
 * Disallow complete -> pending on the same snapshot lineage (async patch never re-opens pending).
 * @param {string} fromState
 * @param {string} toState
 * @returns {{ allowed: boolean, reason?: string }}
 */
function canTransition(fromState, toState) {
  const from = normalizeState(fromState);
  const to = normalizeState(toState);
  if (from === 'complete' && to === 'pending') {
    return { allowed: false, reason: 'complete_to_pending_forbidden' };
  }
  if (from === 'fallback' && to === 'pending') {
    return { allowed: false, reason: 'fallback_to_pending_forbidden' };
  }
  return { allowed: true };
}

/**
 * @param {{ prevState: string, reasoningStatus: string, reasoningMode: string, providerErrorClass?: string|null }} p
 */
function computePostPatchSnapshotState(p) {
  const prev = normalizeState(p.prevState);
  const status = String(p.reasoningStatus || '').trim().toLowerCase();
  const mode = String(p.reasoningMode || '').trim().toLowerCase();
  const pec = String(p.providerErrorClass || '').trim().toLowerCase();

  if (prev === 'pending') {
    if (status === 'applied') {
      return { state: 'complete', fallback_reason: FALLBACK_REASON.NONE };
    }
    if (pec.includes('schema')) {
      return { state: 'fallback', fallback_reason: FALLBACK_REASON.SCHEMA_INVALID };
    }
    if (mode === 'deterministic_fallback') {
      return {
        state: 'fallback',
        fallback_reason: pec ? FALLBACK_REASON.PROVIDER_ERROR : FALLBACK_REASON.DETERMINISTIC_FALLBACK
      };
    }
    if (mode === 'stub') {
      if (status === 'deferred') {
        return { state: 'fallback', fallback_reason: FALLBACK_REASON.GATE_OR_CONFIDENCE };
      }
      return { state: 'complete', fallback_reason: FALLBACK_REASON.NONE };
    }
    if (status === 'deferred') {
      return { state: 'fallback', fallback_reason: FALLBACK_REASON.GATE_OR_CONFIDENCE };
    }
    return { state: 'complete', fallback_reason: FALLBACK_REASON.NONE };
  }

  if (prev === 'fallback') {
    if (status === 'applied') {
      return { state: 'complete', fallback_reason: FALLBACK_REASON.NONE };
    }
    return { state: 'fallback', fallback_reason: FALLBACK_REASON.GATE_OR_CONFIDENCE };
  }

  if (prev === 'complete') {
    if (status === 'deferred') {
      return { state: 'fallback', fallback_reason: FALLBACK_REASON.GATE_OR_CONFIDENCE };
    }
    return { state: 'complete', fallback_reason: FALLBACK_REASON.NONE };
  }

  if (prev === 'disabled') {
    if (status === 'applied') return { state: 'complete', fallback_reason: FALLBACK_REASON.NONE };
    if (status === 'deferred') {
      return { state: 'fallback', fallback_reason: FALLBACK_REASON.GATE_OR_CONFIDENCE };
    }
    return { state: 'complete', fallback_reason: FALLBACK_REASON.NONE };
  }

  if (status === 'applied') return { state: 'complete', fallback_reason: FALLBACK_REASON.NONE };
  if (status === 'deferred') {
    return { state: 'fallback', fallback_reason: FALLBACK_REASON.GATE_OR_CONFIDENCE };
  }
  return { state: 'complete', fallback_reason: FALLBACK_REASON.NONE };
}

function recordTransition({ fromState, toState, pendingSinceIso = null }) {
  const from = normalizeState(fromState);
  const to = normalizeState(toState);
  if (from === to) return;

  Metrics.increment(`reasoning.fsm.transition.${from}_to_${to}.count`, 1);

  if (from === 'pending' && pendingSinceIso) {
    const t0 = new Date(pendingSinceIso).getTime();
    if (Number.isFinite(t0)) {
      const delta = Math.max(0, Date.now() - t0);
      Metrics.increment('reasoning.fsm.transition.latency_ms.pending_to_terminal.total', delta);
      Metrics.increment('reasoning.fsm.transition.latency_ms.pending_to_terminal.count', 1);
    }
  }
}

module.exports = {
  FALLBACK_REASON,
  normalizeState,
  canTransition,
  computePostPatchSnapshotState,
  recordTransition
};
