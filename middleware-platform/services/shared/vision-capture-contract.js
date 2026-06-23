/**
 * Canonical contract for event-driven vision capture.
 * Batch 1 scope:
 * 1) canonical event names and payload schemas
 * 2) schema versioning
 * 3) region enum + normalization
 * 4) quality issue enum
 * 5) provider_review_required + quality_band on result
 */

const SCHEMA_VERSION = '1.0';

const VISION_CAPTURE_EVENTS = Object.freeze({
  REQUESTED: 'vision_capture_requested',
  RESULT: 'vision_capture_result'
});

const VISION_REGION_ENUM = Object.freeze([
  'forehead',
  'cheek_left',
  'cheek_right',
  'chin',
  'neck',
  'arm',
  'leg',
  'trunk',
  'scalp',
  'other'
]);

const VISION_QUALITY_ISSUES = Object.freeze([
  'blurry',
  'too_dark',
  'overexposed',
  'occluded',
  'wrong_region',
  'too_far',
  'too_close',
  'motion'
]);

const VISION_QUALITY_BANDS = Object.freeze(['poor', 'fair', 'good', 'excellent']);

function normalizeRegion(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'other';
  const aliases = {
    forehead: 'forehead',
    brow: 'forehead',
    eyebrow: 'forehead',
    cheek: 'cheek_left',
    'left cheek': 'cheek_left',
    cheek_left: 'cheek_left',
    'right cheek': 'cheek_right',
    cheek_right: 'cheek_right',
    chin: 'chin',
    jaw: 'chin',
    jawline: 'chin',
    neck: 'neck',
    arm: 'arm',
    arms: 'arm',
    leg: 'leg',
    legs: 'leg',
    trunk: 'trunk',
    torso: 'trunk',
    chest: 'trunk',
    abdomen: 'trunk',
    scalp: 'scalp'
  };
  const normalized = aliases[raw] || raw.replace(/\s+/g, '_');
  return VISION_REGION_ENUM.includes(normalized) ? normalized : 'other';
}

function normalizeQualityIssue(issue) {
  const raw = String(issue || '').trim().toLowerCase().replace(/\s+/g, '_');
  return VISION_QUALITY_ISSUES.includes(raw) ? raw : null;
}

function normalizeQualityBand(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (VISION_QUALITY_BANDS.includes(raw)) return raw;
  return 'fair';
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function uniqueQualityIssues(issues) {
  const arr = Array.isArray(issues) ? issues : [issues];
  const out = [];
  for (const i of arr) {
    const n = normalizeQualityIssue(i);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

function baseEnvelope(eventType, data = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    event_type: eventType,
    emitted_at: data.emitted_at || new Date().toISOString(),
    trace_id: data.trace_id || null
  };
}

function buildVisionCaptureRequested(data = {}) {
  return {
    ...baseEnvelope(VISION_CAPTURE_EVENTS.REQUESTED, data),
    session_id: String(data.session_id || '').trim() || null,
    requested_region: normalizeRegion(data.requested_region),
    reason: String(data.reason || 'initial').trim() || 'initial',
    attempt_index: Number.isFinite(Number(data.attempt_index)) ? Number(data.attempt_index) : 1,
    expires_at: data.expires_at || null
  };
}

function buildVisionCaptureResult(data = {}) {
  const candidates = Array.isArray(data.candidate_frame_urls)
    ? data.candidate_frame_urls.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 8)
    : [];
  const bestFrameUrl = String(data.best_frame_url || '').trim() || null;
  return {
    ...baseEnvelope(VISION_CAPTURE_EVENTS.RESULT, data),
    session_id: String(data.session_id || '').trim() || null,
    requested_region: normalizeRegion(data.requested_region),
    detected_region: normalizeRegion(data.detected_region),
    quality_issues: uniqueQualityIssues(data.quality_issues || []),
    provider_review_required: !!data.provider_review_required,
    quality_band: normalizeQualityBand(data.quality_band),
    best_frame_url: bestFrameUrl,
    candidate_frame_urls: candidates,
    region_confidence: clamp01(data.region_confidence),
    quality_score: clamp01(data.quality_score)
  };
}

module.exports = {
  SCHEMA_VERSION,
  VISION_CAPTURE_EVENTS,
  VISION_REGION_ENUM,
  VISION_QUALITY_ISSUES,
  VISION_QUALITY_BANDS,
  normalizeRegion,
  normalizeQualityIssue,
  normalizeQualityBand,
  buildVisionCaptureRequested,
  buildVisionCaptureResult
};
