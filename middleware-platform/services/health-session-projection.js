'use strict';

const healthSessionService = require('./health-session-service');
const healthVideoOpqrst = require('./health-video-opqrst');

function loadProjection(sessionId) {
  const session = healthSessionService.getById(sessionId);
  if (!session) return null;
  const transcript = healthSessionService.listTranscripts(sessionId) || [];
  const metadata = session.metadata || {};
  return {
    sessionId: session.id,
    roomId: session.room_id,
    locale: session.locale,
    replyLanguage: session.reply_language,
    transcript,
    opqrst: metadata.opqrst || {},
    negations: metadata.negations || {},
    opqrstReport: healthVideoOpqrst.toReportSection(metadata.opqrst || {}, metadata.negations || {}),
    vision: metadata.vision_artifacts || [],
    safety: metadata.safety_flags || [],
    lastRag: metadata.last_citations || [],
    visitSummary: metadata.visit_summary || null
  };
}

module.exports = {
  loadProjection
};
