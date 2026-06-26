'use strict';

const healthVideoOpqrst = require('./health-video-opqrst');
const healthSessionService = require('./health-session-service');
const { recommendPathway } = require('./health-care-pathway');

function buildVisitSummary(sessionId, roomId) {
  const session = sessionId
    ? healthSessionService.getById(sessionId)
    : healthSessionService.getByRoom(roomId);
  if (!session) return null;

  const lines = healthSessionService.listTranscripts(session.id) || [];
  const patientLines = lines.filter((l) => l.speaker === 'patient' || l.speaker === 'user');
  const chiefComplaint = patientLines[0]?.text || null;
  const metadata = session.metadata || {};
  const pathway = recommendPathway({
    metadata,
    safetyFlags: metadata.safety_flags || []
  });

  return {
    chief_complaint: chiefComplaint,
    opqrst: healthVideoOpqrst.toReportSection(metadata.opqrst || {}, metadata.negations || {}),
    urgency: pathway.urgency,
    pathway_summary: pathway.summary,
    pathway_reasons: pathway.reasons,
    vision_artifacts: metadata.vision_artifacts || [],
    languages: { ui: session.locale, reply: session.reply_language },
    disclaimer: 'This summary is for education only and is not a diagnosis or medical advice.',
    generated_at: new Date().toISOString()
  };
}

module.exports = {
  buildVisitSummary
};
