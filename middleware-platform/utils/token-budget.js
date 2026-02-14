/**
 * Token Budget (Section 10 - Middleware Brain Improvements)
 *
 * Per-call token tracking: prevents runaway Groq usage.
 * MAX_TOKENS_PER_CALL (default 10000); graceful fallback when exceeded.
 */

const MAX_TOKENS_PER_CALL = parseInt(process.env.MAX_TOKENS_PER_CALL || '10000', 10);
const ABUSE_THRESHOLD = parseInt(process.env.TOKEN_ABUSE_ALERT_THRESHOLD || '50000', 10);

const callTokens = new Map();

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
}

/**
 * Get budget config for metrics
 */
function getConfig() {
  return {
    max_per_call: MAX_TOKENS_PER_CALL,
    abuse_threshold: ABUSE_THRESHOLD,
    active_calls: callTokens.size
  };
}

module.exports = {
  MAX_TOKENS_PER_CALL,
  estimateTokens,
  addTokens,
  getUsed,
  canProceed,
  reset,
  getConfig
};
