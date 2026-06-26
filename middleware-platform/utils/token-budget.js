/**
 * Token Budget (Section 10 - Middleware Brain Improvements)
 *
 * Per-call token tracking: prevents runaway Groq usage.
 * MAX_TOKENS_PER_CALL (default 10000); graceful fallback when exceeded.
 *
 * Video Consult: Separate cost tracking per room (VIDEO_CONSULT_MAX_COST_PER_SESSION).
 */

const MAX_TOKENS_PER_CALL = parseInt(process.env.MAX_TOKENS_PER_CALL || '10000', 10);
const ABUSE_THRESHOLD = parseInt(process.env.TOKEN_ABUSE_ALERT_THRESHOLD || '50000', 10);
const VIDEO_CONSULT_MAX_COST = parseFloat(process.env.VIDEO_CONSULT_MAX_COST_PER_SESSION || '10', 10);

const HEALTH_SESSION_MAX_TOKENS = parseInt(process.env.HEALTH_SESSION_MAX_TOKENS || '25000', 10);
const HEALTH_SESSION_MAX_RAG = parseInt(process.env.HEALTH_SESSION_MAX_RAG_CALLS || '24', 10);
const HEALTH_SESSION_MAX_FRAMES = parseInt(process.env.HEALTH_SESSION_MAX_FRAMES || '12', 10);

const healthSessionUsage = new Map();
const videoConsultCosts = new Map();
const PERSIST_PATH = process.env.TOKEN_BUDGET_PERSIST_PATH || '';

function loadPersistedTokens() {
  if (!PERSIST_PATH) return;
  try {
    const fs = require('fs');
    if (!fs.existsSync(PERSIST_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(PERSIST_PATH, 'utf8'));
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) callTokens.set(k, Number(v) || 0);
    }
  } catch (e) {
    console.warn('[token-budget] load persist failed:', e.message);
  }
}

function persistTokens() {
  if (!PERSIST_PATH) return;
  try {
    const fs = require('fs');
    const obj = Object.fromEntries(callTokens.entries());
    fs.writeFileSync(PERSIST_PATH, JSON.stringify(obj));
  } catch (e) {
    console.warn('[token-budget] persist failed:', e.message);
  }
}

loadPersistedTokens();

/**
 * Rough token estimate: ~4 chars per token for LLMs
 */
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Add tokens used for a call. Call with callId and { prompt_tokens, completion_tokens } or total.
 */
function addTokens(callId, usage) {
  const key = callId || 'standalone';
  const total = typeof usage === 'number'
    ? usage
    : (usage?.prompt_tokens ?? usage?.input_tokens ?? 0) + (usage?.completion_tokens ?? usage?.output_tokens ?? 0);
  const current = callTokens.get(key) || 0;
  const next = current + total;
  callTokens.set(key, next);
  persistTokens();
  if (next > ABUSE_THRESHOLD) {
    console.warn(`⚠️  Token abuse alert: call ${key} used ${next} tokens (threshold: ${ABUSE_THRESHOLD})`);
  }
  return next;
}

/**
 * Get tokens used so far for a call
 */
function getUsed(callId) {
  return callTokens.get(callId || 'standalone') || 0;
}

/**
 * Check if call can proceed with estimated additional tokens
 */
function canProceed(callId, estimatedTokens) {
  const used = getUsed(callId);
  return used + estimatedTokens <= MAX_TOKENS_PER_CALL;
}

/**
 * Reset token count when call ends
 */
function reset(callId) {
  if (callId) callTokens.delete(callId);
  callTokens.delete('standalone');
  persistTokens();
}

/**
 * Get budget config for metrics
 */
function getConfig() {
  return {
    max_per_call: MAX_TOKENS_PER_CALL,
    abuse_threshold: ABUSE_THRESHOLD,
    active_calls: callTokens.size,
    video_consult_max_cost: VIDEO_CONSULT_MAX_COST,
    video_consult_active_rooms: videoConsultCosts.size
  };
}

// ═══════════════════════════════════════════════════════════════════
// Video Consult cost tracking (separate from voice)
// ═══════════════════════════════════════════════════════════════════

const COST_ALERT_THRESHOLD = parseFloat(process.env.VIDEO_CONSULT_COST_ALERT_THRESHOLD || '15', 10);

function addVideoConsultCost(roomId, costUsd) {
  const key = roomId || 'unknown';
  const current = videoConsultCosts.get(key) || 0;
  const next = current + (typeof costUsd === 'number' ? costUsd : 0);
  videoConsultCosts.set(key, next);
  if (next >= COST_ALERT_THRESHOLD) {
    console.warn(`⚠️  [video-consult] Cost alert: room ${key} at $${next.toFixed(2)} (threshold: $${COST_ALERT_THRESHOLD})`);
  }
  return next;
}

function getVideoConsultCost(roomId) {
  return videoConsultCosts.get(roomId || 'unknown') || 0;
}

function canProceedVideoConsult(roomId, estimatedCostUsd = 0) {
  const used = getVideoConsultCost(roomId);
  return used + estimatedCostUsd <= VIDEO_CONSULT_MAX_COST;
}

function resetVideoConsult(roomId) {
  if (roomId) videoConsultCosts.delete(roomId);
}

// ═══════════════════════════════════════════════════════════════════
// Health session usage (Groq tokens, RAG calls, vision frames)
// ═══════════════════════════════════════════════════════════════════

function _healthKey(sessionId) {
  return sessionId || 'unknown';
}

function getHealthSessionUsage(sessionId) {
  const key = _healthKey(sessionId);
  return healthSessionUsage.get(key) || { tokens: 0, rag: 0, frames: 0 };
}

function canProceedHealthSession(sessionId, { tokens = 0, rag = 0, frames = 0 } = {}) {
  const used = getHealthSessionUsage(sessionId);
  if (used.tokens + tokens > HEALTH_SESSION_MAX_TOKENS) return false;
  if (used.rag + rag > HEALTH_SESSION_MAX_RAG) return false;
  if (used.frames + frames > HEALTH_SESSION_MAX_FRAMES) return false;
  return true;
}

function addHealthSessionUsage(sessionId, { tokens = 0, rag = 0, frames = 0 } = {}) {
  const key = _healthKey(sessionId);
  const used = getHealthSessionUsage(sessionId);
  const next = {
    tokens: used.tokens + (tokens || 0),
    rag: used.rag + (rag || 0),
    frames: used.frames + (frames || 0)
  };
  healthSessionUsage.set(key, next);
  return next;
}

function resetHealthSession(sessionId) {
  if (sessionId) healthSessionUsage.delete(_healthKey(sessionId));
}

module.exports = {
  MAX_TOKENS_PER_CALL,
  VIDEO_CONSULT_MAX_COST,
  HEALTH_SESSION_MAX_TOKENS,
  HEALTH_SESSION_MAX_RAG,
  HEALTH_SESSION_MAX_FRAMES,
  estimateTokens,
  addTokens,
  getUsed,
  canProceed,
  reset,
  getConfig,
  addVideoConsultCost,
  getVideoConsultCost,
  canProceedVideoConsult,
  resetVideoConsult,
  getHealthSessionUsage,
  canProceedHealthSession,
  addHealthSessionUsage,
  resetHealthSession
};
