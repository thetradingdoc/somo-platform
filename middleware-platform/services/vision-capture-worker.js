const {
  claimNextRequestedEvent,
  insertVisionCaptureEvent
} = require('./vision-capture-store');
const db = require('../database');
const Metrics = require('./metrics');
const { visionFlags } = require('./vision-feature-flags');
const { sampleFramesForTrigger, pickSharpestFrame } = require('./vision-frame-selector');
const { detectRegionFromFrame } = require('./vision-roi-detector');
const { scoreFrameQuality } = require('./vision-quality-scorer');
const { mapVisionInferenceToResult } = require('./vision-capture-result-mapper');

let timer = null;

function _processRequestedEvent(row) {
  const startedAt = Date.now();
  try {
    const flags = visionFlags();
    if (!flags.triggering) return;
    const payload = JSON.parse(row.payload_json || '{}');
    const sessionId = row.session_id || payload.session_id || null;
    const requestedRegion = payload.requested_region || 'other';
    const roomId = payload.room_id || payload.room || null;

    const existingFrames = roomId && db.getVideoConsultFrames
      ? (db.getVideoConsultFrames(roomId) || [])
      : [];
    const sampled = sampleFramesForTrigger(existingFrames, {
      maxFrames: payload.max_frames || 3,
      windowMs: payload.window_ms || 12000
    });
    const picked = pickSharpestFrame(sampled);
    const bestFrame = picked?.best_frame || null;
    const candidateUrls = (picked?.candidates || [])
      .map((f) => f.frame_url)
      .filter(Boolean);

    let roi;
    let quality;
    if (!bestFrame) {
      // Fallback for uncertain/empty model inputs (no usable frame yet).
      roi = { detected_region: 'other', region_confidence: 0.1 };
      quality = { quality_score: 0.1, quality_band: 'poor', quality_issues: ['occluded', 'too_dark'] };
    } else {
      roi = flags.roi
        ? detectRegionFromFrame(bestFrame || {}, requestedRegion)
        : { detected_region: requestedRegion || 'other', region_confidence: 0.5 };
      quality = flags.quality
        ? scoreFrameQuality(bestFrame || {}, {
            requestedRegion,
            detectedRegion: roi.detected_region
          })
        : { quality_score: 0.7, quality_band: 'good', quality_issues: [] };
    }

    const result = mapVisionInferenceToResult({
      session_id: sessionId,
      trace_id: payload.trace_id || null,
      requested_region: requestedRegion,
      detected_region: roi.detected_region,
      quality_issues: quality.quality_issues,
      quality_band: quality.quality_band,
      provider_review_required:
        flags.providerReview && quality.quality_band === 'fair' && quality.quality_issues.length > 0,
      region_confidence: roi.region_confidence,
      quality_score: quality.quality_score,
      best_frame_url: bestFrame?.frame_url || null,
      candidate_frame_urls: candidateUrls
    });
    insertVisionCaptureEvent({
      event_type: result.event_type,
      session_id: result.session_id,
      trace_id: result.trace_id,
      actor: 'vision_worker',
      payload: result
    });
    Metrics.increment('vision.capture.worker_runs', 1);
    Metrics.increment('vision.capture.worker_frames_sampled', (picked?.candidates || []).length);
    Metrics.increment('vision.capture.cost_usd_cents', Math.round(((picked?.candidates || []).length * 0.2) * 100) / 100);
    Metrics.increment('vision.capture.latency_ms_total', Date.now() - startedAt);
  } catch (e) {
    console.warn('[vision-capture-worker] process failed:', e.message);
    Metrics.increment('vision.capture.worker_errors', 1);
  }
}

function runVisionCaptureWorkerOnce() {
  const row = claimNextRequestedEvent();
  if (!row) return false;
  _processRequestedEvent(row);
  return true;
}

function startVisionCaptureWorker() {
  if (timer) return;
  timer = setInterval(() => {
    runVisionCaptureWorkerOnce();
  }, 1200);
}

function stopVisionCaptureWorker() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = {
  startVisionCaptureWorker,
  stopVisionCaptureWorker,
  runVisionCaptureWorkerOnce
};
