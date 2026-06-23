'use strict';

const express = require('express');
const KellyToolExecutor = require('../../services/kelly/kelly-tool-executor');

const ALLOWED_FUNNEL_EVENTS = new Set([
  'auth_handoff_continue_web',
  'auth_handoff_app_link_shown',
  'auth_handoff_app_link_failed',
]);

function registerPatientFunnelBridgeRoutes(app, { apiLimiter, requirePatientSession, recordPatientPortalEvent }) {
  app.post(
    '/api/patient/funnel/bridge',
    (req, res, next) => apiLimiter(req, res, next),
    express.json({ limit: '64kb' }),
    requirePatientSession,
    (req, res) => {
      try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const sessionId = req.patientSessionId;
        if (!sessionId) {
          return res.status(401).json({ success: false, error: 'session_required' });
        }

        const matchResult = body.match_result || body.match || null;
        const concernId = String(body.concern_id || matchResult?.concern_id || '').trim();
        const inquiry = String(body.inquiry || '').trim();
        const zip = String(body.zip || '').replace(/\D/g, '').slice(0, 5) || null;
        const faceRead = body.face_read && typeof body.face_read === 'object' ? body.face_read : null;
        const userGoal = String(body.user_goal || matchResult?.user_goal || '').trim() || null;
        const route = matchResult?.route || body.route || null;
        const companionConcernId =
          String(body.companion_concern_id || matchResult?.companion_concern_id || '').trim() || null;
        const clarifyAnswers =
          body.clarify_answers && typeof body.clarify_answers === 'object'
            ? body.clarify_answers
            : null;
        const secondaryConcernIds = Array.isArray(body.secondary_concern_ids)
          ? body.secondary_concern_ids
          : Array.isArray(matchResult?.secondary_concern_ids)
            ? matchResult.secondary_concern_ids
            : [];

        const kellySessionId =
          String(body.kelly_session_id || matchResult?.kelly_session_id || '').trim() || null;

        const intakeProposal =
          body.intake_proposal && typeof body.intake_proposal === 'object'
            ? body.intake_proposal
            : matchResult?.intake_proposal && typeof matchResult.intake_proposal === 'object'
              ? matchResult.intake_proposal
              : null;

        const payload = {
          match: matchResult,
          concern_id: concernId || null,
          inquiry: inquiry || null,
          zip,
          face_read: faceRead,
          user_goal: userGoal,
          route,
          companion_concern_id: companionConcernId,
          clarify_answers: clarifyAnswers,
          secondary_concern_ids: secondaryConcernIds,
          kelly_session_id: kellySessionId,
          intake_proposal: intakeProposal,
          bridged_at: new Date().toISOString(),
        };

        KellyToolExecutor._setSessionMeta(sessionId, 'funnel_match_json', JSON.stringify(payload));
        if (concernId) {
          KellyToolExecutor._setSessionMeta(sessionId, 'funnel_concern_id', concernId);
        }
        if (userGoal) {
          KellyToolExecutor._setSessionMeta(sessionId, 'funnel_user_goal', userGoal);
        }
        if (route) {
          KellyToolExecutor._setSessionMeta(sessionId, 'funnel_route', route);
        }
        const dermIntent = String(matchResult?.derm_intent || body.derm_intent || '').trim();
        if (dermIntent) {
          KellyToolExecutor._setSessionMeta(sessionId, 'funnel_derm_intent', dermIntent);
        }
        if (companionConcernId) {
          KellyToolExecutor._setSessionMeta(sessionId, 'funnel_companion_concern_id', companionConcernId);
        }
        if (inquiry) {
          KellyToolExecutor._setSessionMeta(sessionId, 'skin_concerns_json', JSON.stringify({ inquiry, concern_id: concernId }));
        }
        if (zip) {
          KellyToolExecutor._setSessionMeta(sessionId, 'funnel_zip', zip);
        }
        if (secondaryConcernIds.length) {
          KellyToolExecutor._setSessionMeta(
            sessionId,
            'funnel_secondary_concern_ids',
            JSON.stringify(secondaryConcernIds),
          );
        }
        if (kellySessionId) {
          KellyToolExecutor._setSessionMeta(sessionId, 'funnel_kelly_session_id', kellySessionId);
        }
        if (intakeProposal) {
          KellyToolExecutor._setSessionMeta(
            sessionId,
            'funnel_intake_proposal_json',
            JSON.stringify(intakeProposal),
          );
        }

        return res.json({ success: true, session_id: sessionId });
      } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
      }
    },
  );

  app.post(
    '/api/patient/funnel/event',
    (req, res, next) => apiLimiter(req, res, next),
    express.json({ limit: '16kb' }),
    requirePatientSession,
    (req, res) => {
      try {
        const sessionId = req.patientSessionId;
        if (!sessionId) {
          return res.status(401).json({ success: false, error: 'session_required' });
        }
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const eventName = String(body.event || body.event_name || '').trim();
        if (!ALLOWED_FUNNEL_EVENTS.has(eventName)) {
          return res.status(400).json({ success: false, error: 'invalid_event' });
        }
        const metadata = {
          route: body.route != null ? String(body.route) : null,
          concern_id: body.concern_id != null ? String(body.concern_id) : null,
          user_goal: body.user_goal != null ? String(body.user_goal) : null,
        };
        if (typeof recordPatientPortalEvent === 'function') {
          recordPatientPortalEvent(req, eventName, metadata);
        }
        return res.json({ success: true, event: eventName });
      } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
      }
    },
  );
}

module.exports = { registerPatientFunnelBridgeRoutes, ALLOWED_FUNNEL_EVENTS };
