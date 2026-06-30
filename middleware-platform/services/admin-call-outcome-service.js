/**
 * Post-call outcome analysis and stage suggestions (HITL).
 */

const db = require('../database');
const facade = require('./admin-lead-facade');

const STAGE_KEYWORDS = {
  demo: ['demo', 'schedule a call', 'book a meeting', 'interested in seeing'],
  contacted: ['call back', 'follow up', 'send information', 'email me'],
  won: ['sign up', 'ready to start', 'let\'s proceed', 'purchase'],
  lost: ['not interested', 'no thanks', 'remove me', 'do not call'],
};

function suggestStageFromTranscript(text) {
  if (!text || text.length < 20) return null;
  const lower = text.toLowerCase();
  for (const [stage, phrases] of Object.entries(STAGE_KEYWORDS)) {
    if (phrases.some((p) => lower.includes(p))) {
      return {
        stage: stage === 'demo' ? 'demo' : stage,
        note: `Suggested from call transcript (${stage} signals detected)`,
        confidence: 0.6,
      };
    }
  }
  if (lower.includes('receptionist') || lower.includes('front desk')) {
    return { stage: 'contacted', note: 'Follow-up suggested after initial conversation', confidence: 0.4 };
  }
  return null;
}

async function processCallEnded(leadCall, callId, callData = {}) {
  if (!leadCall?.lead_id) return null;

  let transcriptText = callData.transcript || callData.transcript_text || '';
  if (!transcriptText && callId) {
    try {
      const RetellService = require('./retell-service');
      const retell = new RetellService();
      const t = await retell.getCallTranscript?.(callId);
      transcriptText = t?.transcript || t?.text || '';
    } catch {
      // optional
    }
  }

  const suggestion = suggestStageFromTranscript(transcriptText);
  if (suggestion) {
    db.updateLead(leadCall.lead_id, {
      suggested_stage: suggestion.stage,
      suggested_stage_note: suggestion.note,
    });
  }

  try {
    const LeadIntelligenceService = require('./lead-intelligence-service');
    LeadIntelligenceService.updateLeadScore(leadCall.lead_id);
  } catch {
    // non-critical
  }

  return suggestion;
}

module.exports = {
  suggestStageFromTranscript,
  processCallEnded,
};
