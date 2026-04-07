function toNum(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/**
 * Batch 5 policy:
 * - fallback behavior when model/frame output uncertain
 * - state transitions
 * - retry + escalation
 * - "good enough" handling
 * - user giving up after repeated failures
 */
function evaluateVisionResultOutcome(result, existingRow = null, opts = {}) {
  const maxRetries = Math.max(1, toNum(opts.maxRetries, toNum(process.env.VISION_CAPTURE_MAX_RETRIES, 3)));
  const prevAttempts = toNum(existingRow?.attempts, 0);
  const nextAttempts = prevAttempts + 1;

  const qualityIssues = Array.isArray(result?.quality_issues) ? result.quality_issues : [];
  const hasIssues = qualityIssues.length > 0;
  const wrongRegion = qualityIssues.includes('wrong_region');
  const score = toNum(result?.quality_score, 0);
  const band = String(result?.quality_band || '').toLowerCase();
  const hasFrame = !!String(result?.best_frame_url || '').trim();

  const sameRegion =
    !result?.requested_region ||
    result.requested_region === 'other' ||
    result.detected_region === result.requested_region;

  const strictPass = sameRegion && !hasIssues && (band === 'good' || band === 'excellent');
  const goodEnough = sameRegion && hasFrame && !wrongRegion && (band === 'fair' || score >= 0.45);

  if (strictPass) {
    return {
      status: 'passed',
      attempts: nextAttempts,
      provider_review_required: false,
      user_give_up: false
    };
  }

  if (goodEnough) {
    return {
      status: 'passed',
      attempts: nextAttempts,
      provider_review_required: true,
      user_give_up: false
    };
  }

  if (nextAttempts >= maxRetries) {
    return {
      status: 'failed_max_retries',
      attempts: nextAttempts,
      provider_review_required: true,
      user_give_up: true
    };
  }

  return {
    status: 'retry_needed',
    attempts: nextAttempts,
    provider_review_required: !!result?.provider_review_required,
    user_give_up: false
  };
}

module.exports = {
  evaluateVisionResultOutcome
};
