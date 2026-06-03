'use strict';

const db = require('../../database');

const MAX_HISTORY_TURNS = parseInt(process.env.KELLY_MAX_HISTORY_TURNS || '20', 10);

function ensureHistoryTable() {
  try {
    db.db.prepare(`
      CREATE TABLE IF NOT EXISTS kelly_conversation_history (
        id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
        session_id  TEXT NOT NULL,
        role        TEXT NOT NULL,
        content     TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
  } catch (_) {}
}

function loadHistory(sessionId) {
  ensureHistoryTable();
  try {
    const rows = db.db
      .prepare(
        `SELECT role, content FROM kelly_conversation_history
         WHERE session_id = ?
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .all(sessionId, MAX_HISTORY_TURNS * 2);
    return rows.map((r) => ({ role: r.role, content: r.content }));
  } catch (_) {
    return [];
  }
}

function appendHistory(sessionId, role, content) {
  if (!sessionId || !content) return;
  ensureHistoryTable();
  try {
    db.db
      .prepare(
        `INSERT INTO kelly_conversation_history (session_id, role, content, created_at)
         VALUES (?, ?, ?, datetime('now'))`
      )
      .run(sessionId, role, String(content));
    db.db
      .prepare(
        `DELETE FROM kelly_conversation_history
         WHERE session_id = ? AND id NOT IN (
           SELECT id FROM kelly_conversation_history
           WHERE session_id = ?
           ORDER BY created_at DESC
           LIMIT ?
         )`
      )
      .run(sessionId, sessionId, MAX_HISTORY_TURNS * 2);
  } catch (e) {
    console.warn('[kelly-rails] history append failed:', e.message);
  }
}

module.exports = { loadHistory, appendHistory, MAX_HISTORY_TURNS };
