'use strict';

/**
 * Pre-start hook for npm start. Face-read inference is optional for provider portal / RCM.
 * Never fails startup — only logs configuration status.
 */

const path = require('path');

// #region agent log
function debugLog(message, data, hypothesisId) {
  fetch('http://127.0.0.1:7543/ingest/a415f78f-06bc-471d-9251-324ff2e64d53', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '4ae50e' },
    body: JSON.stringify({
      sessionId: '4ae50e',
      runId: process.env.DEBUG_RUN_ID || 'pre-fix',
      hypothesisId,
      location: 'ensure-face-read-env.cjs',
      message,
      data,
      timestamp: Date.now()
    })
  }).catch(() => {});
}
// #endregion

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (_) {
  /* dotenv optional */
}

const base = String(process.env.FACE_READ_INFERENCE_BASE_URL || '').trim();
const autoStart = process.env.FACE_READ_AUTO_START;

// #region agent log
debugLog('ensure-face-read-env entry', { hasBaseUrl: Boolean(base), autoStart: autoStart || null }, 'H1');
// #endregion

if (!base) {
  console.log(
    '[ensure-face-read-env] FACE_READ_INFERENCE_BASE_URL not set — face-read proxy disabled (OK for provider portal).'
  );
} else {
  console.log(`[ensure-face-read-env] FACE_READ_INFERENCE_BASE_URL=${base}`);
}

// #region agent log
debugLog('ensure-face-read-env exit', { exitCode: 0 }, 'H1');
// #endregion

process.exit(0);
