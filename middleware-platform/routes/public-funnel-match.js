'use strict';

const express = require('express');
const funnelMatchService = require('../services/funnel-match-service');

function registerPublicFunnelMatchRoutes(app, { apiLimiter }) {
  app.post('/api/public/funnel/match', apiLimiter, express.json({ limit: '32kb' }), (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const inquiry = String(body.inquiry || body.message || '').trim();
      const concern_chip = String(body.concern_chip || body.concern_id || '').trim() || null;
      const concern_chips = Array.isArray(body.concern_chips)
        ? body.concern_chips
        : Array.isArray(body.concernChips)
          ? body.concernChips
          : concern_chip
            ? [concern_chip]
            : [];
      const zip = String(body.zip || '').trim() || null;
      const confirmed_age =
        body.confirmed_age != null
          ? Number(body.confirmed_age)
          : body.confirmedAge != null
            ? Number(body.confirmedAge)
            : null;
      const face_read = body.face_read && typeof body.face_read === 'object' ? body.face_read : null;
      const user_goal = String(body.user_goal || body.userGoal || 'track_program').trim();
      const clarify_answers =
        body.clarify_answers && typeof body.clarify_answers === 'object'
          ? body.clarify_answers
          : body.clarifyAnswers && typeof body.clarifyAnswers === 'object'
            ? body.clarifyAnswers
            : null;

      const result = funnelMatchService.match({
        inquiry,
        concern_chip: concern_chip || concern_chips[0] || null,
        concern_chips,
        face_read,
        confirmed_age: Number.isFinite(confirmed_age) ? confirmed_age : null,
        zip,
        user_goal,
        clarify_answers,
      });

      return res.json({ success: true, match: result });
    } catch (e) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });
}

module.exports = { registerPublicFunnelMatchRoutes };
