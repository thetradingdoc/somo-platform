'use strict';

/**
 * Optional dev helper: health-check face-read inference if FACE_READ_INFERENCE_BASE_URL is set.
 * Does not spawn processes (teamkelly may live outside this repo).
 */

const path = require('path');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {
  /* ignore */
}

async function ensureFaceReadInference() {
  const base = String(process.env.FACE_READ_INFERENCE_BASE_URL || '').trim().replace(/\/$/, '');
  if (!base || process.env.FACE_READ_AUTO_START === '0') {
    return;
  }

  const timeoutMs = Number(process.env.FACE_READ_HEALTH_TIMEOUT_MS || 2000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(`${base}/health`, { signal: controller.signal });
    if (r.ok) {
      console.log(`[face-read] Inference service reachable at ${base}`);
      return;
    }
    console.warn(`[face-read] Inference health returned HTTP ${r.status} at ${base}`);
  } catch (err) {
    console.warn(
      `[face-read] Inference not reachable at ${base} (${err?.message || err}). ` +
        'Start teamkelly separately or unset FACE_READ_INFERENCE_BASE_URL.'
    );
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { ensureFaceReadInference };
