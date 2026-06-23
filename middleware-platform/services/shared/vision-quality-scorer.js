const { normalizeRegion } = require('./vision-capture-contract');

/**
 * Batch 4 quality scorer:
 * deterministic quality issues + score/band thresholds.
 */
function qualityBandFromScore(score) {
  if (score >= 0.85) return 'excellent';
  if (score >= 0.65) return 'good';
  if (score >= 0.45) return 'fair';
  return 'poor';
}

function scoreFrameQuality(frame = {}, { requestedRegion = 'other', detectedRegion = 'other' } = {}) {
  const issues = [];
  let score = 0.8;

  const lap = Number(
    frame.laplacian_variance ??
      frame.lap_var ??
      frame.sharpness_score ??
      null
  );
  if (Number.isFinite(lap)) {
    if (lap < 40) {
      issues.push('blurry');
      score -= 0.35;
    } else if (lap < 80) {
      score -= 0.15;
    }
  }

  const brightness = Number(frame.brightness_score ?? frame.brightness ?? null);
  if (Number.isFinite(brightness)) {
    if (brightness < 0.2) {
      issues.push('too_dark');
      score -= 0.25;
    } else if (brightness > 0.95) {
      issues.push('overexposed');
      score -= 0.2;
    }
  }

  if (frame.occluded === true) {
    issues.push('occluded');
    score -= 0.2;
  }
  if (frame.motion_blur === true) {
    issues.push('motion');
    score -= 0.15;
  }

  const req = normalizeRegion(requestedRegion);
  const got = normalizeRegion(detectedRegion);
  if (req !== 'other' && got !== 'other' && req !== got) {
    issues.push('wrong_region');
    score -= 0.3;
  }

  score = Math.max(0, Math.min(1, score));
  return {
    quality_score: score,
    quality_band: qualityBandFromScore(score),
    quality_issues: [...new Set(issues)]
  };
}

module.exports = {
  scoreFrameQuality,
  qualityBandFromScore
};
