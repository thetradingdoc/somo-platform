'use strict';

const Groq = require('groq-sdk');
const videoConsultService = require('./video-consult-service');
const healthSessionService = require('./health-session-service');
const healthVideoOpqrst = require('./health-video-opqrst');
const { loadProjection } = require('./health-session-projection');

const groqClient = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

function transcriptFromDb(sessionId) {
  const rows = healthSessionService.listTranscripts(sessionId) || [];
  return rows
    .map((r) => (r.text ? `${r.speaker}: ${r.text}` : ''))
    .filter(Boolean)
    .join('\n');
}

function transcriptFromMemory(roomId) {
  const arr = videoConsultService.getLiveTranscript(roomId) || [];
  return arr
    .map((t) => {
      const speaker = t.speaker || 'unknown';
      const text = t.text || t.content || '';
      return text ? `${speaker}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

function transcriptLines(roomId, sessionId) {
  const fromDb = sessionId ? transcriptFromDb(sessionId) : '';
  if (fromDb.trim()) return fromDb;
  return transcriptFromMemory(roomId);
}

function extractChiefComplaint(transcript) {
  const lines = transcript.split('\n').filter((l) => /^(patient|user):/i.test(l));
  return lines[0]?.replace(/^(patient|user):\s*/i, '').trim() || null;
}

/**
 * Patient-facing structured session report.
 */
async function buildPatientReport(roomId) {
  const session = healthSessionService.getByRoom(roomId);
  const sessionId = healthSessionService.sessionIdFromRoom(roomId);
  const transcript = transcriptLines(roomId, sessionId);
  const replyLanguage = session?.reply_language || 'en';
  const metadata = session?.metadata || {};
  const projection = sessionId ? loadProjection(sessionId) : null;
  const opqrst = projection?.opqrstReport || healthVideoOpqrst.toReportSection(metadata.opqrst || {}, metadata.negations || {});
  const visitSummary = projection?.visitSummary || metadata.visit_summary || null;

  const base = {
    chief_complaint: visitSummary?.chief_complaint || extractChiefComplaint(transcript),
    opqrst,
    visit_summary: visitSummary,
    vision_artifacts: metadata.vision_artifacts || [],
    safety_flags: metadata.safety_flags || [],
    citations: projection?.lastRag || metadata.last_citations || [],
    languages: { ui: session?.locale || 'en', reply: replyLanguage },
    transcript_excerpt: transcript.slice(0, 2000),
    generated_at: new Date().toISOString()
  };

  if (!groqClient || !transcript.trim()) {
    return {
      ...base,
      summary: transcript.trim()
        ? 'Your session has ended. A full report could not be generated automatically.'
        : 'Your session has ended. No conversation was captured.',
      language: replyLanguage
    };
  }

  const systemPrompt = `You are Kelly, a physician assistant writing a brief patient-facing health chat summary.
Use plain language. Include: what the patient discussed, general education points, and when to seek urgent or in-person care.
Do not diagnose. End with a short disclaimer that this is not medical advice or a diagnosis.
Write the summary in language code: ${replyLanguage}. If not English, include a one-line English clinical stub at the end prefixed "Clinical stub:".`;

  try {
    const completion = await groqClient.chat.completions.create({
      model: process.env.HEALTH_REPORT_MODEL || 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Transcript:\n${transcript.slice(0, 6000)}` }
      ],
      temperature: 0.3,
      max_tokens: 800
    });
    const summary = completion.choices?.[0]?.message?.content?.trim() || '';
    return { ...base, summary, language: replyLanguage };
  } catch (e) {
    console.warn('[health-session-report] Groq failed:', e.message);
    return {
      ...base,
      summary: 'Your session has ended. Report generation failed; please try again later.',
      language: replyLanguage,
      error: e.message
    };
  }
}

async function finalizeSession(roomId) {
  const sessionId = healthSessionService.sessionIdFromRoom(roomId);
  if (!sessionId) return null;
  const report = await buildPatientReport(roomId);
  healthSessionService.saveReport(sessionId, report);
  return healthSessionService.endSession(sessionId, report);
}

module.exports = {
  buildPatientReport,
  finalizeSession,
  transcriptLines
};
