/**
 * Tool Call DLQ Worker (Section 2 - Middleware Brain Improvements)
 *
 * Polls dlq_tool_calls; logs size for metrics. Optionally alerts when backlog exceeds threshold.
 * Items are auditable; manual retry or investigation via GET /api/admin/dlq-tool-calls.
 */

const ALERT_THRESHOLD = parseInt(process.env.DLQ_TOOL_CALLS_ALERT_THRESHOLD || '50', 10);
const POLL_INTERVAL_MS = parseInt(process.env.DLQ_TOOL_CALLS_POLL_MS || '300000', 10); // 5 min default

let intervalId = null;

function processDlqMetrics() {
  try {
    const db = require('../database');
    if (typeof db.getDlqToolCallsSize !== 'function') return;

    const size = db.getDlqToolCallsSize();
    if (size > 0) {
      console.log(`📋 Tool call DLQ: ${size} failed call(s) pending review`);
      if (size >= ALERT_THRESHOLD) {
        console.warn(`⚠️  Tool call DLQ threshold exceeded (${size} >= ${ALERT_THRESHOLD}). See docs/runbooks/README.md#error-rate-spike`);
        try {
          const Metrics = require('./metrics');
          Metrics.increment('dlq_tool_calls_alert');
        } catch (_) {}
      }
    }
  } catch (err) {
    console.warn('⚠️  Tool call DLQ metrics check failed:', err.message);
  }
}

function start() {
  if (intervalId) return;
  intervalId = setInterval(processDlqMetrics, POLL_INTERVAL_MS);
  processDlqMetrics(); // Run once on start
  console.log(`📋 Tool call DLQ worker started (interval ${POLL_INTERVAL_MS / 1000}s)`);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('📋 Tool call DLQ worker stopped');
  }
}

module.exports = {
  start,
  stop,
  processDlqMetrics
};
