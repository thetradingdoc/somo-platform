'use strict';

/**
 * Landing assistant turn_seq gate (web voice / chat).
 * `latestCompletedSeq` is updated only after a turn is successfully persisted so retries
 * before persistence can replay the same seq, while duplicates after success are skipped.
 *
 * @param {number} incomingTurnSeq — client turn counter (>0 when sequencing is enabled)
 * @param {number} latestCompletedSeq — last persisted turn_seq for this session (from kelly_session_meta_kv)
 * @returns {{ skip: boolean, reason?: string }}
 */
function shouldSkipLandingTurnSeq(incomingTurnSeq, latestCompletedSeq) {
  const incoming = Number(incomingTurnSeq);
  if (!Number.isFinite(incoming) || incoming <= 0) {
    return { skip: false };
  }
  const latest = Math.max(0, Number(latestCompletedSeq) || 0);
  if (incoming <= latest) {
    return { skip: true, reason: 'stale_or_duplicate_turn' };
  }
  return { skip: false };
}

module.exports = {
  shouldSkipLandingTurnSeq
};
