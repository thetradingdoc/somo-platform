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

function parseConversationHistory(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function lastAssistantFromMessages(messages = []) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m?.role === 'assistant' && String(m.content || '').trim()) {
      return String(m.content).trim();
    }
  }
  return '';
}

function orchestrateHistoryMessages(dbAdapter, sessionId) {
  if (!dbAdapter?.getOrchestrateSessionBySessionId || !sessionId) return [];
  try {
    const row = dbAdapter.getOrchestrateSessionBySessionId(sessionId);
    return parseConversationHistory(row?.conversation_history);
  } catch (_) {
    return [];
  }
}

/**
 * G-1 lastAssistantText adapter — Kelly history first, orchestrate fallback.
 */
function getLastAssistantText(sessionId, opts = {}) {
  if (opts.override != null && String(opts.override).trim()) {
    return String(opts.override).trim();
  }
  const fromKelly = lastAssistantFromMessages(loadHistory(sessionId));
  if (fromKelly) return fromKelly;
  const fromOrch = lastAssistantFromMessages(orchestrateHistoryMessages(opts.db, sessionId));
  if (fromOrch) return fromOrch;
  return '';
}

/**
 * One-time legacy backfill: patient_orchestrate_sessions → kelly_conversation_history.
 *
 * Intentionally one-directional and deprecated — only runs when the Kelly history table
 * is empty for the session. Does not sync back to orchestrate or merge when Kelly already
 * has rows (orchestrate may hold a longer legacy transcript; Kelly Rails SSOT wins after
 * first V2 turn). Safe to call repeatedly; returns false when no backfill occurred.
 */
function seedKellyHistoryFromOrchestrate(sessionId, dbAdapter) {
  if (!sessionId) return false;
  const existing = loadHistory(sessionId);
  if (existing.length > 0) return false;
  const messages = orchestrateHistoryMessages(dbAdapter, sessionId);
  if (!messages.length) return false;
  if (process.env.NODE_ENV !== 'test' && messages.length > 0) {
    console.info(
      `[kelly-rails] seedKellyHistoryFromOrchestrate: one-way backfill ${messages.length} turn(s) for ${sessionId}`
    );
  }
  for (const m of messages) {
    const role = m?.role;
    const content = String(m?.content || m?.content_english || '').trim();
    if ((role === 'user' || role === 'assistant') && content) {
      appendHistory(sessionId, role, content);
    }
  }
  return true;
}

module.exports = {
  loadHistory,
  appendHistory,
  lastAssistantFromMessages,
  getLastAssistantText,
  seedKellyHistoryFromOrchestrate,
  MAX_HISTORY_TURNS
};
