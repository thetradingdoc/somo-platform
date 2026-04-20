'use strict';

const { createHash } = require('crypto');
const db = require('../database');
const KellyToolExecutor = require('./kelly-tool-executor');
const Metrics = require('./metrics');

const META_CONTEXT_VERSION = 'landing_context_version';
const META_CONTEXT_IDEMPOTENCY_KEYS = 'landing_context_idempotency_keys_json';

function toSafeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeIdempotencyKey(raw) {
  const key = String(raw || '').trim();
  return key ? key.slice(0, 180) : '';
}

function buildDeterministicIdempotencyKey({
  sessionId,
  eventType,
  text = '',
  fileName = '',
  mimeType = '',
  productData = null
}) {
  const h = createHash('sha256');
  h.update(String(sessionId || ''));
  h.update('|');
  h.update(String(eventType || ''));
  h.update('|');
  h.update(String(text || '').slice(0, 2048));
  h.update('|');
  h.update(String(fileName || ''));
  h.update('|');
  h.update(String(mimeType || ''));
  h.update('|');
  try {
    h.update(JSON.stringify(productData || {}));
  } catch (_) {
    h.update('');
  }
  return `ctx_${h.digest('hex').slice(0, 40)}`;
}

function getCurrentContextVersion(sessionId) {
  const raw = Number(KellyToolExecutor._getSessionMeta(sessionId, META_CONTEXT_VERSION) || 0);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

function appendLandingContextEvent({
  sessionId,
  eventType,
  text,
  fileName = null,
  mimeType = null,
  productData = null,
  actor = 'user',
  source = 'unknown',
  metadata = {},
  idempotencyKey = '',
  expectedContextVersion = null
}) {
  const sid = String(sessionId || '').trim();
  const type = String(eventType || '').trim();
  const bodyText = String(text || '').trim();
  if (!sid || !type || !bodyText) {
    return { success: false, error: 'session_id, event_type, and text are required' };
  }

  const currentVersion = getCurrentContextVersion(sid);
  const hasExpectedVersion =
    expectedContextVersion !== null &&
    expectedContextVersion !== undefined &&
    String(expectedContextVersion).trim() !== '';
  const expected = Number(expectedContextVersion);
  if (hasExpectedVersion && Number.isFinite(expected) && expected <= currentVersion) {
    Metrics.increment('context.write.stale_reject', 1);
    return {
      success: false,
      stale_reject: true,
      context_version: currentVersion,
      error: 'stale_context_version'
    };
  }

  const idemKey = normalizeIdempotencyKey(idempotencyKey) || buildDeterministicIdempotencyKey({
    sessionId: sid,
    eventType: type,
    text: bodyText,
    fileName,
    mimeType,
    productData
  });
  const seenKeys = toSafeArray(KellyToolExecutor._getSessionMeta(sid, META_CONTEXT_IDEMPOTENCY_KEYS))
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  if (seenKeys.includes(idemKey)) {
    Metrics.increment('context.write.duplicate', 1);
    return {
      success: true,
      duplicate: true,
      context_version: currentVersion
    };
  }

  const row = db?.getOrchestrateSessionBySessionId?.(sid) || null;
  const currentFlow = row?.flow_state && typeof row.flow_state === 'object' ? row.flow_state : {};
  const thread = Array.isArray(currentFlow.short_term_thread) ? currentFlow.short_term_thread : [];
  const nextVersion = currentVersion + 1;
  const event = {
    type,
    text: bodyText,
    file_name: fileName ? String(fileName).trim() : null,
    mime_type: mimeType ? String(mimeType).trim() : null,
    product_data: productData && typeof productData === 'object' && !Array.isArray(productData) ? productData : null,
    actor: String(actor || 'user').trim() || 'user',
    source: String(source || 'unknown').trim() || 'unknown',
    context_version: nextVersion,
    idempotency_key: idemKey,
    metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
    created_at: new Date().toISOString()
  };
  const nextThread = [...thread, event].slice(-120);

  if (db?.upsertOrchestrateSession) {
    db.upsertOrchestrateSession({
      session_id: sid,
      channel: row?.channel || 'chat',
      patient_id: row?.patient_id || null,
      portal_session_id: row?.portal_session_id || null,
      clinic_id: row?.clinic_id || null,
      conversation_history: Array.isArray(row?.conversation_history) ? row.conversation_history : [],
      flow_state: { ...currentFlow, short_term_thread: nextThread },
      turn_count: Number(row?.turn_count || 0),
      preferred_language: row?.preferred_language || 'en'
    });
  }

  KellyToolExecutor._setSessionMeta(sid, META_CONTEXT_VERSION, String(nextVersion));
  const nextKeys = [...seenKeys, idemKey].slice(-250);
  KellyToolExecutor._setSessionMeta(sid, META_CONTEXT_IDEMPOTENCY_KEYS, JSON.stringify(nextKeys));
  Metrics.increment('context.write.success', 1);

  return {
    success: true,
    context_version: nextVersion,
    short_term_thread_count: nextThread.length,
    idempotency_key: idemKey
  };
}

module.exports = {
  appendLandingContextEvent,
  getCurrentContextVersion
};
