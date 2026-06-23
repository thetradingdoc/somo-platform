'use strict';

const express = require('express');
const router = express.Router();
const {
  summarizeSessionEvents,
  checkAlertThresholds,
  DEFAULT_THRESHOLDS
} = require('../../services/kelly/kelly-call-telemetry');
const { getRailsSessionProjection } = require('../../services/kelly/rails/session-ssot');

router.get('/sessions/:sessionId/summary', (req, res) => {
  const sessionId = String(req.params.sessionId || '').trim();
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId required' });
  }
  const summary = summarizeSessionEvents(sessionId);
  const projection = getRailsSessionProjection(sessionId);
  return res.json({
    ok: true,
    session_id: sessionId,
    projection: projection
      ? {
          active_lane: projection.active_lane,
          step: projection.step,
          appointment_id: projection.appointment_id,
          updated_at: projection.updated_at
        }
      : null,
    ...summary
  });
});

router.get('/alerts', (req, res) => {
  const windowMinutes = parseInt(req.query.window_minutes || '', 10) || DEFAULT_THRESHOLDS.window_minutes;
  const report = checkAlertThresholds(windowMinutes);
  return res.json(report);
});

module.exports = router;
