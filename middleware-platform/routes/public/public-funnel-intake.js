'use strict';

const express = require('express');
const { runFunnelIntake } = require('../../services/catalog/funnel-intake-orchestrator');

function registerPublicFunnelIntakeRoutes(app, { apiLimiter }) {
  app.post('/api/public/funnel/intake', apiLimiter, express.json({ limit: '48kb' }), async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const concern_chips = Array.isArray(body.concern_chips)
        ? body.concern_chips
        : Array.isArray(body.concernChips)
          ? body.concernChips
          : [];
      const inquiry = String(body.inquiry || body.message || '').trim();
      const not_sure = !!(body.not_sure || body.notSure);
      const user_goal = String(body.user_goal || body.userGoal || 'track_program').trim();
      const kelly_session_id = String(body.kelly_session_id || body.kellySessionId || '').trim() || null;
      const user_confirm_concern_id =
        String(body.user_confirm_concern_id || body.userConfirmConcernId || '').trim() || null;
      const confirmed_age =
        body.confirmed_age != null
          ? Number(body.confirmed_age)
          : body.confirmedAge != null
            ? Number(body.confirmedAge)
            : null;
      const face_read = body.face_read && typeof body.face_read === 'object' ? body.face_read : null;
      const zip = String(body.zip || '').trim() || null;

      const out = await runFunnelIntake({
        concern_chips,
        inquiry,
        not_sure,
        user_goal,
        kelly_session_id,
        user_confirm_concern_id,
        face_read,
        confirmed_age: Number.isFinite(confirmed_age) ? confirmed_age : null,
        zip,
      });

      return res.json(out);
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });
}

module.exports = { registerPublicFunnelIntakeRoutes };
