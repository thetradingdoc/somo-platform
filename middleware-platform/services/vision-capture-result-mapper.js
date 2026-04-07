const { buildVisionCaptureResult } = require('./vision-capture-contract');

/**
 * Batch 4 mapper:
 * map raw/model worker output into canonical vision_capture_result contract.
 */
function mapVisionInferenceToResult({
  session_id,
  trace_id = null,
  requested_region = 'other',
  detected_region = 'other',
  quality_issues = [],
  quality_band = 'fair',
  provider_review_required = false,
  region_confidence = null,
  quality_score = null,
  best_frame_url = null,
  candidate_frame_urls = []
} = {}) {
  return buildVisionCaptureResult({
    session_id,
    trace_id,
    requested_region,
    detected_region,
    quality_issues,
    quality_band,
    provider_review_required,
    region_confidence,
    quality_score,
    best_frame_url,
    candidate_frame_urls
  });
}

module.exports = {
  mapVisionInferenceToResult
};
