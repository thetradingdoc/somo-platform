const { normalizeRegion } = require('./vision-capture-contract');

/**
 * Batch 4 ROI detector scaffold:
 * body-part/region detection from raw frame metadata.
 * Note: this is a heuristic bridge until a dedicated body-part model is wired.
 */
function detectRegionFromFrame(frame = {}, requestedRegion = 'other') {
  const detections = Array.isArray(frame.yolo_detections) ? frame.yolo_detections : [];
  const names = detections.map((d) => String(d.class || d.name || '').toLowerCase());
  const confidence = Math.max(
    0,
    ...detections.map((d) => Number(d.confidence || d.conf || 0)).filter((n) => Number.isFinite(n))
  );

  if (names.some((n) => /forehead|brow/.test(n))) return { detected_region: 'forehead', region_confidence: confidence || 0.65 };
  if (names.some((n) => /left_cheek|cheek_left/.test(n))) return { detected_region: 'cheek_left', region_confidence: confidence || 0.65 };
  if (names.some((n) => /right_cheek|cheek_right/.test(n))) return { detected_region: 'cheek_right', region_confidence: confidence || 0.65 };
  if (names.some((n) => /chin|jaw|jawline/.test(n))) return { detected_region: 'chin', region_confidence: confidence || 0.6 };
  if (names.some((n) => /neck/.test(n))) return { detected_region: 'neck', region_confidence: confidence || 0.6 };
  if (names.some((n) => /arm/.test(n))) return { detected_region: 'arm', region_confidence: confidence || 0.58 };
  if (names.some((n) => /leg/.test(n))) return { detected_region: 'leg', region_confidence: confidence || 0.58 };
  if (names.some((n) => /scalp|hair/.test(n))) return { detected_region: 'scalp', region_confidence: confidence || 0.55 };
  if (names.some((n) => /torso|trunk|chest|abdomen/.test(n))) return { detected_region: 'trunk', region_confidence: confidence || 0.55 };

  const requested = normalizeRegion(requestedRegion);
  if (requested && requested !== 'other') {
    // Conservative fallback: keep requested region with low confidence.
    return { detected_region: requested, region_confidence: 0.4 };
  }
  return { detected_region: 'other', region_confidence: 0.25 };
}

module.exports = {
  detectRegionFromFrame
};
