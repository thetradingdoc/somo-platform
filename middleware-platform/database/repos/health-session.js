'use strict';

const db = require('../../database');

function getDb() {
  return db.db || db;
}

function insertSession(row) {
  getDb()
    .prepare(
      `INSERT INTO health_sessions
       (id, room_id, session_status, locale, reply_language, terms_accepted_at, terms_version, session_token, sse_token, sse_token_expires_at, metadata_json)
       VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.roomId,
      row.locale,
      row.replyLanguage,
      row.termsAcceptedAt,
      row.termsVersion,
      row.sessionToken,
      row.sseToken,
      row.sseExpires,
      row.metadataJson
    );
}

function getSessionById(sessionId) {
  return getDb().prepare('SELECT * FROM health_sessions WHERE id = ?').get(sessionId);
}

function getSessionByRoom(roomId) {
  return getDb().prepare('SELECT * FROM health_sessions WHERE room_id = ?').get(roomId);
}

function getSessionTokenRow(sessionId) {
  return getDb().prepare('SELECT session_token FROM health_sessions WHERE id = ?').get(sessionId);
}

function getSseTokenRow(roomId) {
  return getDb()
    .prepare('SELECT sse_token, sse_token_expires_at FROM health_sessions WHERE room_id = ?')
    .get(roomId);
}

function updateSseToken(sessionId, sseToken, sseExpires) {
  getDb()
    .prepare('UPDATE health_sessions SET sse_token = ?, sse_token_expires_at = ? WHERE id = ?')
    .run(sseToken, sseExpires, sessionId);
}

function updateMetadataJson(sessionId, metadataJson) {
  getDb()
    .prepare('UPDATE health_sessions SET metadata_json = ? WHERE id = ?')
    .run(metadataJson, sessionId);
}

function insertTranscript(row) {
  getDb()
    .prepare(
      `INSERT INTO health_session_transcripts
       (session_id, room_id, speaker, text, text_original, text_translated, source, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.sessionId,
      row.roomId,
      row.speaker,
      row.text,
      row.textOriginal,
      row.textTranslated,
      row.source,
      row.ts
    );
}

function listTranscriptsBySession(sessionId) {
  return getDb()
    .prepare('SELECT * FROM health_session_transcripts WHERE session_id = ? ORDER BY ts ASC')
    .all(sessionId);
}

function upsertReport(sessionId, reportJson) {
  getDb()
    .prepare(
      `INSERT INTO health_session_reports (session_id, report_json) VALUES (?, ?)
       ON CONFLICT(session_id) DO UPDATE SET report_json = excluded.report_json`
    )
    .run(sessionId, reportJson);
  getDb()
    .prepare('UPDATE health_sessions SET report_json = ? WHERE id = ?')
    .run(reportJson, sessionId);
}

function endSessionRow(sessionId, endedAt) {
  getDb()
    .prepare(`UPDATE health_sessions SET session_status = 'ended', ended_at = ? WHERE id = ?`)
    .run(endedAt, sessionId);
}

module.exports = {
  insertSession,
  getSessionById,
  getSessionByRoom,
  getSessionTokenRow,
  getSseTokenRow,
  updateSseToken,
  updateMetadataJson,
  insertTranscript,
  listTranscriptsBySession,
  upsertReport,
  endSessionRow
};
