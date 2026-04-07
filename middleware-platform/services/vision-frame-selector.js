/**
 * Batch 4:
 * - frame sampling policy (1-3 frames per trigger)
 * - sharpest-frame pre-filter (Laplacian variance when available)
 */

function toEpochMs(ts) {
  const t = Date.parse(String(ts || ''));
  return Number.isFinite(t) ? t : 0;
}

function normalizeFrame(frame = {}) {
  return {
    frame_url: frame.frame_url || frame.url || null,
    timestamp: frame.timestamp || new Date().toISOString(),
    yolo_detections: frame.yolo_detections || frame.detections || [],
    // Upstream may provide one of these metrics.
    laplacian_variance:
      frame.laplacian_variance ??
      frame.lap_var ??
      frame.sharpness_score ??
      null
  };
}

function sampleFramesForTrigger(frames = [], opts = {}) {
  const maxFrames = Math.max(1, Math.min(3, Number(opts.maxFrames) || 3));
  const windowMs = Math.max(1000, Number(opts.windowMs) || 12000);
  const now = Date.now();
  const normalized = (Array.isArray(frames) ? frames : []).map(normalizeFrame);
  const inWindow = normalized.filter((f) => {
    const ts = toEpochMs(f.timestamp);
    return ts > 0 ? now - ts <= windowMs : true;
  });
  const source = inWindow.length ? inWindow : normalized;
  return source.slice(-maxFrames);
}

function sharpnessScore(frame = {}) {
  const lap = Number(frame.laplacian_variance);
  if (Number.isFinite(lap) && lap >= 0) return lap;
  // Fallback proxy if no Laplacian metric exists yet: prefer richer detections.
  const detections = Array.isArray(frame.yolo_detections) ? frame.yolo_detections : [];
  const detScore = detections.reduce((acc, d) => acc + Number(d.confidence || d.conf || 0), 0);
  return detScore;
}

function pickSharpestFrame(sampledFrames = []) {
  const list = Array.isArray(sampledFrames) ? sampledFrames : [];
  if (!list.length) return null;
  let best = list[0];
  let bestScore = sharpnessScore(best);
  for (let i = 1; i < list.length; i += 1) {
    const s = sharpnessScore(list[i]);
    if (s > bestScore) {
      best = list[i];
      bestScore = s;
    }
  }
  return {
    best_frame: best,
    best_sharpness: bestScore,
    candidates: list
  };
}

module.exports = {
  sampleFramesForTrigger,
  pickSharpestFrame
};
