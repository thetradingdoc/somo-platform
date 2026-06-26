'use strict';

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const healthRepo = require('../database/repos/health-session');

const TERMS_VERSION = process.env.HEALTH_TERMS_VERSION || '2026-06-25';
const SSE_TOKEN_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession({
  locale = 'en',
  replyLanguage = 'en',
  termsAccepted = false,
  termsVersion = TERMS_VERSION,
  displayName = null,
  metadata = {}
} = {}) {
  if (!termsAccepted) {
    const err = new Error('terms_accepted is required');
    err.statusCode = 400;
    throw err;
  }
  const id = uuidv4();
  const roomId = `health-${id}`;
  const now = new Date().toISOString();
  const sessionToken = generateToken();
  const sseToken = generateToken();
  const sseExpires = new Date(Date.now() + SSE_TOKEN_TTL_MS).toISOString();

  healthRepo.insertSession({
    id,
    roomId,
    locale,
    replyLanguage: replyLanguage || locale,
    termsAcceptedAt: now,
    termsVersion,
    sessionToken,
    sseToken,
    sseExpires,
    metadataJson: JSON.stringify({
      channel: 'video_health',
      consent: { terms_version: termsVersion, accepted_at: now },
      ...(displayName ? { display_name: displayName } : {}),
      ...metadata
    })
  });
  return getById(id);
}

function getById(sessionId) {
  const row = healthRepo.getSessionById(sessionId);
  if (!row) return null;
  return formatRow(row);
}

function getByRoom(roomId) {
  const row = healthRepo.getSessionByRoom(roomId);
  if (!row) return null;
  return formatRow(row);
}

function verifySessionToken(sessionId, token) {
  if (!sessionId || !token) return false;
  const row = healthRepo.getSessionTokenRow(sessionId);
  return row?.session_token === token;
}

function verifySseToken(roomId, token) {
  if (!isHealthRoom(roomId) || !token) return false;
  const row = healthRepo.getSseTokenRow(roomId);
  if (!row || row.sse_token !== token) return false;
  if (row.sse_token_expires_at && new Date(row.sse_token_expires_at) < new Date()) return false;
  return true;
}

function refreshSseToken(sessionId) {
  const sseToken = generateToken();
  const sseExpires = new Date(Date.now() + SSE_TOKEN_TTL_MS).toISOString();
  healthRepo.updateSseToken(sessionId, sseToken, sseExpires);
  return { sse_token: sseToken, sse_token_expires_at: sseExpires };
}

function updateMetadata(sessionId, patch) {
  const existing = getById(sessionId);
  if (!existing) return null;
  const merged = { ...(existing.metadata || {}), ...patch };
  healthRepo.updateMetadataJson(sessionId, JSON.stringify(merged));
  return getById(sessionId);
}

function persistTranscript(sessionId, roomId, item) {
  if (!sessionId || !item?.text) return null;
  healthRepo.insertTranscript({
    sessionId,
    roomId,
    speaker: item.speaker || 'unknown',
    text: item.text,
    textOriginal: item.text_original || null,
    textTranslated: item.text_translated || null,
    source: item.source || 'stt',
    ts: item.ts || new Date().toISOString()
  });
  return true;
}

function listTranscripts(sessionId) {
  return healthRepo.listTranscriptsBySession(sessionId);
}

function saveReport(sessionId, report) {
  const json = JSON.stringify(report);
  healthRepo.upsertReport(sessionId, json);
}

function endSession(sessionId, report = null) {
  const existing = getById(sessionId);
  if (!existing) return null;
  const endedAt = new Date().toISOString();
  if (report) saveReport(sessionId, report);
  healthRepo.endSessionRow(sessionId, endedAt);
  return getById(sessionId);
}

function attachReport(sessionId, report) {
  saveReport(sessionId, report);
  return getById(sessionId);
}

function formatRow(row) {
  let report = null;
  let metadata = null;
  try {
    if (row.report_json) report = JSON.parse(row.report_json);
  } catch (_) {}
  try {
    if (row.metadata_json) metadata = JSON.parse(row.metadata_json);
  } catch (_) {}
  return {
    id: row.id,
    room_id: row.room_id,
    session_status: row.session_status,
    locale: row.locale,
    reply_language: row.reply_language,
    terms_version: row.terms_version,
    terms_accepted_at: row.terms_accepted_at,
    session_token: row.session_token,
    sse_token: row.sse_token,
    sse_token_expires_at: row.sse_token_expires_at,
    report,
    metadata,
    created_at: row.created_at,
    ended_at: row.ended_at
  };
}

function isHealthRoom(roomId) {
  return typeof roomId === 'string' && roomId.startsWith('health-');
}

function sessionIdFromRoom(roomId) {
  if (!isHealthRoom(roomId)) return null;
  return roomId.replace(/^health-/, '');
}

/** Public session shape — strips secrets */
function toPublicSession(session) {
  if (!session) return null;
  const { session_token, sse_token, ...rest } = session;
  return rest;
}

module.exports = {
  TERMS_VERSION,
  createSession,
  getById,
  getByRoom,
  verifySessionToken,
  verifySseToken,
  refreshSseToken,
  updateMetadata,
  persistTranscript,
  listTranscripts,
  saveReport,
  endSession,
  attachReport,
  isHealthRoom,
  sessionIdFromRoom,
  toPublicSession
};
