'use strict';

/** @param {string} hypothesisId @param {string} location @param {string} message @param {object} data */
function stediArchLog(hypothesisId, location, message, data = {}) {
  // #region agent log
  fetch('http://127.0.0.1:7543/ingest/a415f78f-06bc-471d-9251-324ff2e64d53', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '4ae50e' },
    body: JSON.stringify({
      sessionId: '4ae50e',
      runId: process.env.STEDI_ARCH_DEBUG_RUN || 'sandbox',
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now()
    })
  }).catch(() => {});
  // #endregion
}

module.exports = { stediArchLog };
